import express from "express";
import { pool } from "./db.js"
import { anthropic } from "./llm.js";

const app = express();



app.use(express.json());



app.get("/health",  async (_req, res) => {
    try {
        await pool.query("SELECT")
        res.json({ ok: true, db: "up" })
    } catch (err){
        console.error("db check failed err: ", err)
        res.status(503).json({ok: false, db: "down"})
    }
    
});

app.post("/chat", async (req, res) => {
    const { message } = req.body as { message? : string};
    if (!message) {
        res.status(400).json({ error: "message is required"});
        return;
    }

    try {
        const response = await anthropic.messages.create({
            model: "claude-sonnet-5",
            max_tokens: 1024,
            messages: [{ role: "user", content: message}]
        })

        const text = response.content
            .filter((b) => b.type === "text")
            .map((b) => b.text)
            .join("");
        res.json({ reply: text })
    } catch (err) {
        console.error("char failed, err: ", err)
        res.status(500).json({error: "chat failed"})
    }
})

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {

    console.log(`listening on http://localhost:${port}`)
})