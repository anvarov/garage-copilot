import { readFile } from "node:fs/promises";
import { pool } from "./db.js";
import { chunkText } from "./chunk.js";
import { embed } from "./embed.js";
import { parseFrontmatter } from "./parseFrontmatter.js";

type DocumentMeta = {
    sourceType: string,
    title: string,
    sourceUrl?: string | undefined,
    author?: string | undefined,
    license?: string | undefined
};

export async function ingestText(text: string, meta: DocumentMeta) {
    const chunks = chunkText(text)
    const embeddings = await embed(chunks)
    if (embeddings.length !== chunks.length) throw new Error("embeddings length doesn't match chunks length")
    const client = await pool.connect()
    try {
        await client.query('BEGIN')
        const { rows } = await client.query<{ id: string }>(
            "INSERT INTO documents (source_type, title, author, license, source_url) VALUES ($1, $2, $3, $4, $5) RETURNING id;",
            [meta.sourceType, meta.title, meta.author, meta.license, meta.sourceUrl]
        )
        const row = rows[0]
        if (!row) throw new Error("insert return no id")

        for (const [ordinal, chunk] of chunks.entries()) {
            await client.query(
                "INSERT INTO chunks (document_id, ordinal, content, embedding) VALUES ($1, $2, $3, $4);",
                [row.id, ordinal, chunk, JSON.stringify(embeddings[ordinal])]
            );
        }
        await client.query("COMMIT;")
        return { documentId: row.id, chunkCount: chunks.length }
    } catch (err) {
        await client.query("ROLLBACK;")
        throw new Error(`ingest failed for ${meta.title}: ${(err as Error).message}`);
    } finally {
        client.release()
    }
}

export async function ingestFile(
    path: string,
): Promise<{ documentId: string; chunkCount: number }> {
    const file = await readFile(path, "utf-8")
    const { meta, body: text } = parseFrontmatter(file)
    if (meta.title === undefined){
        throw new Error(`frontmatter is missing key, please check source file ${path}, title is missing, recieved metadata: ${Object.keys(meta).join(", ")}`)
    
    } else if (meta.source_type === undefined) {
        throw new Error(`frontmatter is missing key, please check source file ${path}, source_type is missing, recieved metadata:${Object.keys(meta).join(", ")}`)
    }
    const metadata: DocumentMeta = {
        author: meta.author,
        sourceUrl: meta.source_url,
        title: meta.title,
        sourceType: meta.source_type,
        license: meta.license
    }
    return await ingestText(text, metadata)
}
