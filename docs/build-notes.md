# Build Notes

Running record of what's built, what's next, and why things were decided the way they were. Read this instead of scrolling back through chat.

---

## What this is for

**The information is already public. The problem is that nobody can search for a procedure name they don't know.**

Tesla publishes its service manuals free and without a login. But an owner types *"clunking over bumps"* and the manual is indexed under *"Front Upper Control Arm Replacement."* The gap is not access — it is the mapping from **how a problem feels** to **what the procedure is called**.

That gap is why semantic retrieval is the right tool rather than keyword search, and it showed up by accident on Aug 16: the question said "clunking", the top-ranked chunk said "knock", no shared keyword, correct match.

### Diagnose, then instruct — and never confuse the two

The app has two jobs and they need different sources:

| kind | job | sources |
|---|---|---|
| **symptom language** | *diagnosis* — map what the owner said to what is likely wrong | NHTSA complaints, Stack Exchange questions |
| **procedure** | *instruction* — what to actually do, once the fault is identified | OEM service manual, first-party notes |

A complaint is **evidence** about what is probably broken. A manual section is **authority** on how to fix it. Collapsing the two produces an owner's guess presented as a repair instruction, which is the failure mode that matters most here.

This is why `source_type` reaches the model in the passage header, not just the title — the model must be able to tell a described noise from a manufacturer procedure, because those license completely different sentences in the answer:

```
[1] OEM SERVICE MANUAL — "Front Upper Control Arm Replacement":
[2] OWNER COMPLAINT (NHTSA) — "2023 Model 3, clunking over bumps":
```

And it constrains the corpus: not just volume, but **both kinds covering the same components**. A complaint about clunking is only useful if there is a control-arm procedure for it to point at.

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
- [x] `chunkText()` with overlap, plus unit tests
- [x] `ingestFile()` — read → chunk → embed → insert `documents` + `chunks` in one transaction. CLI at `src/cli/ingest.ts`
- [x] Embeddings: OpenAI `text-embedding-3-small` → `chunks.embedding`, verified with a nearest-neighbour query in psql
- [x] Retrieval: `retrieve()` embeds the question, joins chunks to documents, returns ranked passages with metadata
- [x] Citations: `/chat` builds numbered passages, streams the answer with inline `[n]` citations, sends an `event: sources` frame before generation
- [x] Refusal behaviour verified — an out-of-corpus question ("oil change on a Honda Civic") is declined rather than answered from training knowledge

**Week 2 complete.** Full RAG pipeline: file → chunks → embeddings → pgvector → retrieval → grounded answer with citations.
- [ ] Real corpus: Stack Exchange (CC BY-SA, attributed) + first-party repair notes

---

## Known limitations

**Chunking splits mid-word.** Fixed-size character windows cut through words and sentences — chunk 3 of the fixture begins `"d on many suspension components"`. Retrieval survives it thanks to the overlap, but the chunks read badly, and they will read badly in citations shown to users. Next iteration: split on paragraph or sentence boundaries first, then pack up to the size limit.

**Frontmatter is embedded as content.** The fixture's `---` header ends up inside chunk 0 and gets embedded as if it were repair text. Real corpus files will have YAML frontmatter too, so stripping it is a genuine ingestion step rather than a fixture quirk.

**Re-ingesting a file creates a duplicate document row.** No natural key, no upsert. Every re-run doubles the data and pays for embeddings again. Needs a source identifier plus either delete-then-insert or `ON CONFLICT`.

**No vector index.** A sequential scan over 7 rows is free; over thousands it won't be. HNSW once there's enough data to make tuning meaningful.

**Sources are sent before the model decides whether it can answer.** Sending the `event: sources` frame immediately after `flushHeaders()` buys a faster first paint, but it commits to those sources before knowing they're usable. On an out-of-corpus question the client receives five irrelevant citations alongside "I can't answer this." Fix: check the best distance before streaming and send an empty list if nothing clears a threshold. Observed distances on good matches were 0.45–0.63, so a cutoff around 0.7 is a reasonable starting point.

**Sources aren't deduplicated by document.** Five chunks from one document produce five entries with the same title. The UI should group by document.

**Provenance should reach the model deliberately, not accidentally.** The fixture's frontmatter happened to land in chunk 0, and the model correctly used it to caveat its answer — but only by luck of chunking. Better: strip frontmatter from content and put `source_type` and `license` into the passage header the prompt builds, so every passage carries its own trust level regardless of where the chunk boundaries fell.

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

**"No recalls" and "could not check" must never collapse into each other.** A lookup returning `{count: 0, recalls: []}` means the vehicle has none on record. A lookup that throws means nothing is known. Three separate mechanisms keep them apart: the tool result carries `is_error: true`, the message says "The recall lookup FAILED... This is not a result" rather than being empty, and `SYSTEM_PROMPT` names the distinction directly. Verified by breaking `ENDPOINT` — the model answered "I genuinely don't know... this is different from 'no recalls found'" without being asked to make the distinction in that answer. The same principle drives `count` being the true total before capping, so a truncated list cannot pass as complete.

**A failed tool is not a failed request.** `getRecalls` is wrapped in its own try/catch inside the turn loop, and both `messages.push` calls run on either path. Skipping them on failure would leave a `tool_use` block with no matching `tool_result`, which the API rejects outright — a failed tool still owes the model a reply. This also means a throw from `toIso` on a malformed date degrades into "the lookup failed" instead of killing the response after headers are already sent.

**The tool loop has two exits and they mean opposite things.** `break` is the model finishing; exhausting `MAX_TURNS` is us cutting it off mid-thought. Without the `finished` flag both would send `event: done` and a truncated answer would look complete. `MAX_TURNS = 2` allows exactly one tool call — enough for one vehicle, not enough for "my Model 3 and my wife's CR-V". Raising it is low-risk now that exhaustion is reported rather than silent.

**A failed stream discards the partial answer.** When `streamChat` throws mid-stream, `finally` runs `setStreaming("")` and `setMessages` is never reached, so text already on screen disappears and is replaced by the error. This is deliberate, not an oversight. The app answers questions about vehicle repair, and half a procedure is more dangerous than no procedure — it looks complete enough to act on. The alternative (keep the partial text, flag it as incomplete) is defensible for a general chat app and wrong for this one. Note the asymmetry inside that `finally`: clearing `isStreaming` on both paths is what stops a failed request locking the input forever; clearing `streaming` on both paths is what discards the partial answer. Same block, two different reasons.

**Corpus is licensing-constrained, and every source has a stated position.** *Revised Aug 25 — the original policy excluded OEM manuals on the assumption they were paywalled. They are not.* The `author`, `license` and `source_url` columns exist so none of this can be quietly skipped.

| source | status | how it's handled |
|---|---|---|
| NHTSA recalls & complaints | US government work, **public domain** | recalls fetched live via tool-calling; complaints ingested |
| Motor Vehicle Maintenance & Repair Stack Exchange | **CC BY-SA** | attribution required — store `owner.display_name`, the question link, and the licence string |
| Tesla service manual (`service.tesla.com`) | **copyrighted, freely published, no login** | small deliberate sample, `source_url` on the exact page, copyright recorded as retained |
| First-party repair notes | **written here** | facts aren't copyrightable; the expression is ours |
| Tesla forums, Reddit, TMC | **excluded** | other people's copyrighted writing under terms that forbid it |

On the OEM manuals specifically: publicly reachable is not the same as public domain, and Tesla's service-site terms include a clause against unauthorised downloading. The judgement is that a small attributed sample in a non-commercial demo is a defensible trade — but it *is* a trade, taken deliberately rather than by not looking. The position to state if asked:

> *Three sources with three different licensing situations. NHTSA is public domain. Stack Exchange is CC BY-SA, so the author and link are stored. OEM manual content is copyrighted but freely published, so it's a small sample with attribution and a source link — which is why the schema carries author and licence columns at all.*

**Never** generate plausible-looking specifications. Synthetic test text lives in `test/fixtures/` with every value marked `[PLACEHOLDER]`, and stays out of `corpus/`. Verified working: when a retrieved passage was the synthetic fixture, the model recognised the labelling and refused to quote torque values from it.

---

## Gotchas hit so far

**Imports need `.js`, even from `.ts` files.** `import { pool } from "./db.js"` — TypeScript never rewrites import paths, so you write the name of the file that will exist at runtime.

**`pool.query()` cannot run a transaction.** It may use a different connection per statement, so `BEGIN` and `COMMIT` can land on different ones. Use `pool.connect()` for a pinned client and always `release()` it in a `finally`.

**SSE needs a double newline.** `data: <payload>\n\n`. One newline and the client buffers forever. `res.flushHeaders()` is also required or Express buffers the whole response.

**`req.on("close")` is not "client disconnected."** On a POST the request stream completes as soon as the body arrives. Use `res.on("close")` with a `!res.writableEnded` guard.

**Express 5 gives `req.body === undefined`** when nothing was parsed, where Express 4 gave `{}`. Destructure defensively: `(req.body ?? {})`.

**Postgres only initializes a volume once.** Fixing a typo in `POSTGRES_PASSWORD` won't apply to an already-initialized data directory. `docker compose down -v` to wipe and re-init.

**A parser reports where it gave up, not where you went wrong.** `syntax error at or near "("` was caused by a missing comma on the *previous* line. When a syntax error points at a token that looks fine, read backwards one line.

**A guard placed after the action it prevents does nothing.** The first version of the chunker's `break` ran after the `push`, so the redundant trailing chunk was still created. Reads fine top to bottom; does nothing.

**`slice(start, end)` takes an end index, not a length.** Cost an hour in `chunkText`.

**Chunk overlap exists so facts survive the cut.** Without it a boundary can land mid-fact — "…pinch bolt" in one chunk, "45 N·m" in the next — and neither chunk matches a question about pinch bolt torque. The fact is in the corpus and unretrievable. Cost is ~15% more chunks.

**Corpus content must be real or clearly labelled synthetic, never a blend.** A document mixing verified specs into generated prose looks trustworthy and isn't. Synthetic test text lives in `test/fixtures/` with placeholder values, never in `corpus/`.

**Read stack traces for your own frames.** `node_modules` lines say where an error surfaced; the last line naming your file says where it originated. Wrap errors with context as they propagate (`migration ${file} failed: ...`) so the next one diagnoses itself.

---

## Next session

**Retrieval — the step where this becomes a search engine.**

1. `src/retrieve.ts` — take a question string, `embed()` it, then one query:

```sql
SELECT c.content, c.ordinal, d.title, d.author, d.source_url,
       c.embedding <=> $1 AS distance
FROM chunks c
JOIN documents d ON d.id = c.document_id
ORDER BY distance
LIMIT 5;
```

The join is what turns a retrieved chunk into a citation.

2. Wire it into `/chat`: embed the question, retrieve, build a prompt containing those chunks, send to Claude, stream back the answer plus the sources.

3. Test with a question the corpus can actually answer — something about ball joint play or torquing at ride height — and check the retrieved chunks are the ones you'd have picked by hand.

Useful diagnostic while developing:

```sql
-- nearest neighbours to a given chunk, no API call needed
SELECT ordinal,
       round((embedding <=> (SELECT embedding FROM chunks WHERE ordinal = 0))::numeric, 4) AS distance,
       left(content, 60)
FROM chunks ORDER BY distance;
```
