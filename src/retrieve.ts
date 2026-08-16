import { pool } from "./db.js";
import { embed } from "./embed.js";


type RetrievedChunk = {
    content: string,
    title: string,
    author: string | null,
    url: string | null,
    distance: number,
    ordinal: number
}
export async function retrieve(question: string): Promise<RetrievedChunk[]> {
    const embeddings = await embed([question]);    
    const vector = embeddings[0]
    if (!vector) throw new Error("embed returned no vector")

    const limit = 5
    const sql = `SELECT c.content, c.ordinal, d.title, d.author, d.source_url as url, c.embedding <=> $1::vector as distance
                FROM chunks c JOIN documents d ON d.id = c.document_id
                WHERE c.embedding IS NOT NULL
                ORDER BY distance
                LIMIT $2`
    const { rows } = await pool.query<RetrievedChunk>(sql, [JSON.stringify(vector), limit])
    return rows
}
