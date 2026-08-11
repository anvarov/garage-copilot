import { readFile } from "node:fs/promises";
import { pool } from "./db.js";
import { chunkText } from "./chunk.js";

type DocumentMeta = {
    sourceType: string;
    title: string;
    sourceUrl?: string;
    author?: string;
    license?: string
};

export async function ingestFile(
    path: string,
    meta: DocumentMeta
): Promise<{ documentId: string; chunkCount: number }> {
    const text = await readFile(path, "utf-8")
    const chunks = chunkText(text);

    const client = await pool.connect()

    try {
        await client.query("BEGIN;");
        const { rows } = await client.query<{ id: string }>(
            "INSERT INTO documents (source_type, title, author, license, source_url) VALUES ($1, $2, $3, $4, $5) RETURNING id;",
            [meta.sourceType, meta.title, meta.author, meta.license, meta.sourceUrl]
        )
        const row = rows[0];
        if (!row) throw new Error("insert returned no id");

        for (const [ordinal, chunk] of chunks.entries()) {
            await client.query(
                "INSERT INTO chunks (document_id, ordinal, content) VALUES ($1, $2, $3);",
                [row.id, ordinal, chunk]
            );
        }
        await client.query("COMMIT;")
        return { documentId: row.id, chunkCount: chunks.length }
    } catch (err) {
        await client.query("ROLLBACK;")
        throw new Error(`ingest failed for ${path}: ${(err as Error).message}`);
    } finally {
        client.release()
    }
}
