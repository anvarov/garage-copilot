# Build Notes

Running record of what's built, what's next, and why things were decided the way they were. Read this instead of scrolling back through chat.

---

## Status

**Week 1 (Aug 3–9) — complete, a day early**

- [x] Repo, TypeScript, Express, ESLint/Prettier
- [x] `GET /health` — verifies the Postgres connection with `SELECT 1`
- [x] PostgreSQL 17 + pgvector via Docker Compose
- [x] `POST /chat` — streaming over SSE, backed by the Anthropic API
- [x] GitHub Actions CI — install, typecheck, test
- [x] README

**Week 2 (Aug 10–16) — in progress**

- [x] Schema and migration runner — `documents`, `chunks`, `schema_migrations`
- [ ] First corpus document: a first-party repair write-up in `corpus/`
- [ ] Ingestion: read file → chunk → insert rows
- [ ] Embeddings: OpenAI → store in `chunks.embedding`
- [ ] Retrieval: embed the question, find nearest chunks
- [ ] Citations: return source alongside the answer

---

## Commands

```bash
docker compose up -d        # Postgres + pgvector
npm run migrate             # apply migrations
npm run dev                 # API on :3000
npm run typecheck
npm test

# inspect the database
docker compose exec db psql -U garage -d garage
#   \dt        list tables
#   \d chunks  describe a table
```

```bash
# streaming chat — use curl, not Postman (its SSE support on POST is unreliable)
curl -N -X POST localhost:3000/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"What does a torque wrench do?"}'
```

---

## Decisions

**PostgreSQL + pgvector, not a dedicated vector database.** At this corpus size retrieval quality is equivalent, and keeping vectors next to relational data means one backup story, one connection pool, and joins between embeddings and vehicle records without a network hop.

**OpenAI `text-embedding-3-small` for embeddings, Anthropic for generation.** Anthropic has no embeddings endpoint — generating text and embedding text are different models. OpenAI's is ~$0.02 per million tokens, so the whole corpus costs pennies, and it's the best-documented option when something breaks at 11pm. 1536 dimensions, which is hardcoded into `chunks.embedding` — changing models later means re-embedding everything.

**Rejected: a local embedding model.** Free and private, but the weights ship inside the deployed image and load into RAM. Free-tier hosting gives 256–512MB. That's a fight during the week the project needs to be finished.

**Rejected: putting the whole corpus in the prompt.** Works for a small corpus and worth knowing. Breaks on context limits, costs 50× more per question, degrades answer quality with irrelevant context, and gives no basis for citations. Also: retrieval is the skill the AI-tier job postings screen for.

**Plain SQL migrations over an ORM or migration library.** Fewer moving parts, and writing the runner means understanding what those tools do — a `schema_migrations` table and a transaction per file.

**Corpus is licensing-constrained.** No scraping of Tesla forums, Reddit, or TMC — other people's copyrighted writing, under terms that forbid it. Using NHTSA (public domain, via live tool-calling), Motor Vehicle Maintenance & Repair Stack Exchange (Creative Commons, attributed), and first-party repair notes. The `author` and `license` columns exist so this can't be quietly skipped.

---

## Gotchas hit so far

**Imports need `.js`, even from `.ts` files.** `import { pool } from "./db.js"` — TypeScript never rewrites import paths, so you write the name of the file that will exist at runtime.

**`pool.query()` cannot run a transaction.** It may use a different connection per statement, so `BEGIN` and `COMMIT` can land on different ones. Use `pool.connect()` for a pinned client and always `release()` it in a `finally`.

**SSE needs a double newline.** `data: <payload>\n\n`. One newline and the client buffers forever. `res.flushHeaders()` is also required or Express buffers the whole response.

**`req.on("close")` is not "client disconnected."** On a POST the request stream completes as soon as the body arrives. Use `res.on("close")` with a `!res.writableEnded` guard.

**Express 5 gives `req.body === undefined`** when nothing was parsed, where Express 4 gave `{}`. Destructure defensively: `(req.body ?? {})`.

**Postgres only initializes a volume once.** Fixing a typo in `POSTGRES_PASSWORD` won't apply to an already-initialized data directory. `docker compose down -v` to wipe and re-init.

**A parser reports where it gave up, not where you went wrong.** `syntax error at or near "("` was caused by a missing comma on the *previous* line. When a syntax error points at a token that looks fine, read backwards one line.

**Read stack traces for your own frames.** `node_modules` lines say where an error surfaced; the last line naming your file says where it originated. Wrap errors with context as they propagate (`migration ${file} failed: ...`) so the next one diagnoses itself.

---

## Next session

1. `npm run migrate`, confirm three tables with `\dt`
2. Write `src/ingest.ts` — read a markdown file, split into overlapping chunks, insert `documents` + `chunks` rows. No embeddings yet.
3. Write the first corpus document: one of your own repair write-ups, in `corpus/`.
