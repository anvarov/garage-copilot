import express from "express";
import { pool } from "./db.js";
import { anthropic } from "./llm.js";
import { parsePort } from "./config.js";
import { retrieve } from "./retrieve.js";

const app = express();

app.use(express.json());

// Static instructions. Kept free of per-request content so it stays identical
// across calls — that's what prompt caching keys on, and semantically these are
// standing rules rather than context for one turn.
const SYSTEM_PROMPT = `You are a repair assistant for people who work on their own vehicles.

Answer using ONLY the passages provided in the user's message. Do not answer
from general knowledge, even if you are confident.

If the passages do not contain the answer, say so plainly and stop. Do not
speculate.

Cite the passage number inline, like [1] or [2], for every claim you make.

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

    const stream = anthropic.messages.stream({
        model: "claude-sonnet-5",
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMessage }],
    });

    res.on("close", () => {
        if (!res.writableEnded) stream.abort();
    });

    try {
        for await (const event of stream) {
            if (
                event.type === "content_block_delta" &&
                event.delta.type === "text_delta"
            ) {
                res.write(`data: ${JSON.stringify({ text: event.delta.text })}\n\n`);
            }
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
