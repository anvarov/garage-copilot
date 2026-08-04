import express from "express";
import { pool } from "./db.js"

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

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {

    console.log(`listening on http://localhost:${port}`)
})