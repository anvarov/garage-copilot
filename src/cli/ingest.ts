import { ingestFile } from "../ingest.js";
import { pool } from "../db.js";

const path = process.argv[2];

if (!path) {
    console.error("usage: npm run ingest -- <path-to-file>");
    process.exit(1);
}

ingestFile(path)
.then((result) => {
    console.log(`ingested document ${result.documentId}, ${result.chunkCount} chunks`);

})
.catch((err) => {
    console.error(err);
    process.exit(1);
})
.finally(() => pool.end())
