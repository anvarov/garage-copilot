import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { pool } from "./db.js";


const MIGRATIONS_DIR = join(import.meta.dirname, "..", "migrations");

async function migrate(): Promise<void> {
    const client = await pool.connect();

    try {
        await client.query(`
            CREATE TABLE IF NOT EXISTS schema_migrations (
                name        TEXT PRIMARY KEY,
                applied_at      TIMESTAMPTZ NOT NULL DEFAULT now()
                )
        `);
        
        const { rows } = await client.query<{name: string}>("SELECT name FROM schema_migrations");
        const applied = new Set(rows.map((r) => r.name))
        
        const files = (await readdir(MIGRATIONS_DIR))
            .filter((f) => f.endsWith(".sql"))
            .sort()

        for (const file of files) {
            if (applied.has(file)) continue

            console.log(`applying ${file}`);
            const sql = await readFile(join(MIGRATIONS_DIR, file), "utf-8");

            await client.query("BEGIN");
            try {
                await client.query(sql);
                await client.query(
                    "INSERT INTO schema_migrations (name) VALUES ($1)",
                    [file]
                );
                await client.query("COMMIT");
            } catch (err) {
                await client.query("ROLLBACK");
                throw new Error(`migration ${file} failed: ${(err as Error).message}`);
            }
        }
        console.log("migrations up to date");
    } finally {
        client.release()
        await pool.end()
    }
}

migrate().catch((err) => {
    console.error(err)
    process.exit(1)
});