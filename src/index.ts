import express from "express";
import { pool } from "./db.js";
import { anthropic } from "./llm.js";
import { parsePort } from "./config.js";
import { retrieve } from "./retrieve.js";
import { getRecalls, tools, type RecallLookup } from "./tools/nhtsa.js";
import Anthropic from "@anthropic-ai/sdk";
import type { MessageStream } from "@anthropic-ai/sdk/lib/MessageStream.mjs";

const MAX_TURNS = 2

const app = express();

app.use(express.json());

// Static instructions. Kept free of per-request content so it stays identical
// across calls — that's what prompt caching keys on, and semantically these are
// standing rules rather than context for one turn.
const SYSTEM_PROMPT = `You are a repair assistant for people who work on their own vehicles.

You have exactly two sources of fact. Never answer from general knowledge, even
if you are confident.

1. The passages provided in the user's message. Cite these inline by number,
   like [1] or [2], for every claim drawn from them.
2. Recall data returned by the NHTSA_call tool. Cite these by campaign number,
   like 25V092000.

If neither source contains the answer, say so plainly and stop. Do not
speculate.

RECALL LOOKUPS

A lookup that returns no recalls means the vehicle has none on record. A lookup
that FAILS means you do not know. These are completely different and must never
be reported the same way. If the tool returns an error, say the lookup failed
and that the user should check nhtsa.gov directly. Never say or imply that a
vehicle has no open recalls unless a lookup actually succeeded and came back
empty.

If the result reports more recalls than it lists, say the list is partial.

Report the severity flags before anything else, in plain language:
parkIt means stop driving the vehicle. parkOutside means do not park it indoors
or near a structure, because of fire risk. otaUpdate means the fix ships as a
software update and may already be installed.

SAFETY

This is vehicle repair and mistakes are expensive or dangerous. If a torque
value, part number, or clearance is not present in the passages, say that it
must be verified against the manufacturer's service manual rather than
guessing.`;

app.get("/health", async (_req, res) => {
    try {
        await pool.query("SELECT 1");
        res.json({ ok: true, db: "up" });
    } catch (err) {
        console.error("db check failed:", err);
        res.status(503).json({ ok: false, db: "down" });
    }
});

app.post("/chat", async (req, res) => {
    const { message } = (req.body ?? {}) as { message?: string };
    if (!message) {
        res.status(400).json({ error: "message is required" });
        return;
    }

    let chunks;
    try {
        chunks = await retrieve(message);
    } catch (err) {
        // Retrieval failed before any headers were sent, so a normal JSON
        // error response is still possible. Once the SSE stream starts, it
        // isn't — which is why this is handled separately.
        console.error("retrieval failed:", err);
        res.status(500).json({ error: "retrieval failed" });
        return;
    }

    // The model sees numbered passages so it has something to cite. `distance`
    // and `ordinal` are internal and would only burn tokens.
    const passages = chunks
        .map((c, i) => `[${i + 1}] From "${c.title}":\n${c.content}`)
        .join("\n\n");

    // What the client needs to render a citation — not the passage text, which
    // it already receives inside the answer.
    const sources = chunks.map((c, i) => ({
        n: i + 1,
        title: c.title,
        author: c.author,
        url: c.url,
        ordinal: c.ordinal,
    }));

    const userMessage =
        chunks.length === 0
            ? `No passages were retrieved.\n\nQuestion: ${message}`
            : `${passages}\n\n---\n\nQuestion: ${message}`;

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    // Sent before generation starts. The sources are already known, and the
    // model takes a second or two to produce its first token — this lets the
    // client render the sources panel during that wait.
    res.write(`event: sources\ndata: ${JSON.stringify(sources)}\n\n`);

    const messages: Anthropic.MessageParam[] = [{ role: "user", content: userMessage }]
    let currentStream: MessageStream | null = null
    res.on("close", () => {
        if (!res.writableEnded) currentStream?.abort();
    })
    // The loop has two exits and they mean opposite things: `break` is the model
    // finishing, running out of turns is us cutting it off mid-thought. Without
    // this flag both send `event: done` and a truncated answer looks complete —
    // the same empty-vs-failed distinction as a failed recall lookup, one level up.
    let finished = false;

    try {
        for (let turn = 0; turn < MAX_TURNS; turn++) {
            const stream = anthropic.messages.stream({
                model: "claude-sonnet-5",
                max_tokens: 1024,
                system: SYSTEM_PROMPT,
                tools: [...tools],
                tool_choice: { type: "auto", disable_parallel_tool_use: true },
                messages
            });
            currentStream = stream
            for await (const event of stream) {
                if (
                    event.type === "content_block_delta" &&
                    event.delta.type === "text_delta"
                ) {
                    res.write(`data: ${JSON.stringify({ text: event.delta.text })}\n\n`);
                }
            }
            const final = await stream.finalMessage()
            if (final.stop_reason !== "tool_use") {
                finished = true;
                break;
            }

            const toolUse = final.content.find(
                (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
            )
            if (toolUse === undefined) throw new Error("stop_reason was tool_use but no tool_use block was present")
            const { make, model, year } = toolUse.input as { make: string, model: string, year: string }
            let toolResult: string
            let isError = false
            try {
                const result = await getRecalls(make, model, year)
                toolResult = JSON.stringify(result)

            } catch (err) {
                console.error("NHTSA lookup failed:", err)
                isError = true
                // Reports what happened; it does not instruct. The system prompt
                // is where the "say so explicitly" rule lives. And it must not be
                // readable as an empty result — "no recalls" and "could not check"
                // are different claims, and only one of them is safe to guess at.
                toolResult =
                    `The recall lookup FAILED and returned no data: ${(err as Error).message}. ` +
                    `This is not a result. It is unknown whether this vehicle has open recalls.`
            }
            messages.push({ role: "assistant", content: final.content })
            messages.push({
                role: "user", content: [
                    { type: "tool_result", tool_use_id: toolUse.id, content: toolResult, is_error: isError }
                ]
            })
        }
        if (!finished) {
            // Ran out of turns with the model still asking for tools. Whatever
            // streamed is a fragment, so say so rather than closing as if done.
            console.error(`hit MAX_TURNS (${MAX_TURNS}) with the model still requesting tools`);
            res.write(
                `event: error\ndata: ${JSON.stringify({
                    error: "The answer was cut off before it finished. Please ask again.",
                })}\n\n`
            );
        }

        res.write("event: done\ndata: {}\n\n");
    } catch (err) {
        console.error("stream failed:", err);
        res.write(
            `event: error\ndata: ${JSON.stringify({ error: "stream failed" })}\n\n`
        );
    } finally {
        res.end();
    }

});

const port = parsePort(process.env.PORT);
app.listen(port, () => {
    console.log(`listening on http://localhost:${port}`);
});
