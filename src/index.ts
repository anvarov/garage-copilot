import express from "express";
import { pool } from "./db.js"
import { anthropic } from "./llm.js";
import { parsePort } from "./config.js";
import { text } from "node:stream/consumers";

const app = express();



app.use(express.json());



app.get("/health", async (_req, res) => {
    try {
        await pool.query("SELECT")
        res.json({ ok: true, db: "up" })
    } catch (err) {
        console.error("db check failed err: ", err)
        res.status(503).json({ ok: false, db: "down" })
    }

});

app.post("/chat", async (req, res) => {
    const { message } = (req.body ?? {}) as { message?: string };
    if (!message) {
        res.status(400).json({ error: "message is required" });
        return;
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders()

    res.on("close", () => {
        if (!res.writableEnded) stream.abort()
    })
    const stream = anthropic.messages.stream({
        model: "claude-sonnet-5",
        max_tokens: 1024,
        messages: [{ role: "user", content: message }]
    })

    try {
        for await (const event of stream) {
            if (
                event.type === "content_block_delta" &&
                event.delta.type === "text_delta"
            ) {
                res.write(`data: ${JSON.stringify({ text: event.delta.text })}\n\n}`)
            }
        }
    } catch (err) {
        console.error("stream failed", err);
        res.write(`event: error\ndata: ${JSON.stringify({ error: "stream failed" })}\n\n`)
    } finally {
        res.end()
    }
})

const port = parsePort(process.env.PORT);
app.listen(port, () => {

    console.log(`listening on http://localhost:${port}`)
})