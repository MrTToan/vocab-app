---
name: import-vocab
description: Import vocabulary from an external source (a vocabulary PDF/book, or a vocabulary web page/list) into Lexi as a public SYSTEM-owned collection, then Claude-enrich the first N words. Use when the user wants to "import vocab from a PDF", "extract words from a book and add to Lexi", "load a vocabulary PDF into Lexi", "import a word list from a web page", "add a vocabulary source as a collection", or "build a public collection from a document/site". Covers scanned-PDF OCR, HTML scraping, dedup, the idempotent blank-safe import, and Claude-authored enrichment including the IELTS difficulty band. NOT the 30-question practice bank (see enrich-questions-bank) and NOT the production migration.
---

# Import a vocabulary source into Lexi

Turn an external vocabulary source into a **public, SYSTEM-owned** Lexi collection (`owner_id =
__system__`, `visibility = public`) of shared content, then fully **enrich the first N words** with
Claude-authored study content (including the `difficulty` IELTS band). This is the periodic, manual
way to grow the public catalog from a book, PDF, or web page.

The pipeline has **one shared IMPORT + ENRICH core** (identical whatever the source) fed by **one of
two acquisition/extraction front-ends** — pick by source type:

- **(A) Scanned / PDF source** → OCR path (§1A). Many "PDFs" are just page images with no text layer.
- **(B) Web-page source** → fetch + HTML parse (§1B). No OCR; often the source already carries IPA,
  part of speech, meaning, and even a CEFR/IELTS band you can map straight in.

The cost pattern is deliberate: **import ALL rows** seeded from the source (cheap), but **fully enrich
only the first N** now (captain-scoped, e.g. 200). The rest are enriched in later batches. Model the
scripts on `scripts/ingest-public-collections.mjs` and `scripts/import-collocations-idioms.mjs`.

> **Trust rule:** all study content Claude writes (meanings, definitions, examples, IPA, difficulty)
> is authored by **Claude from its own knowledge — NEVER an external LLM/API/web, and never Lexi's own
> LLM chain.** The source seeds the raw term + meaning; Claude authors and *verifies* the rest.

> **Safety:** ALWAYS work against a **COPY** of the DB, NEVER the real `.data/lexi.db` or production.
> Producing the pack + script is your job; applying to production is a **separate, held** step.

---

## 0. Inspect the source structure FIRST

Do not start parsing blind — find *where the vocabulary lives* and in what shape (`term →
vi_meaning → example`). A workbook may keep the cleanest data in an **answer-key / glossary table**,
not the body; a web page may keep it in one big table or in per-section lists. Open a few
representative pages/sections, identify the table/list format and its columns, and note the page or
section ranges before writing any extractor. Time spent here saves a rewrite.

Decide the collection name/emoji/description and the target **N** to fully enrich now.

---

## 1A. Acquire + OCR a scanned / PDF source

1. **Is it scanned (image-only) or does it have real text?** Check before OCR:
   ```bash
   pdffonts "src.pdf" | head        # no fonts listed ⇒ scanned images
   pdftotext -f 1 -l 3 "src.pdf" -   # empty/garbage ⇒ scanned; real text ⇒ skip OCR, parse directly
   ```
2. **OCR is a local, free, non-LLM operation.** Render each page to PNG then OCR with the right
   language packs (English + the L1, e.g. Vietnamese):
   ```bash
   pdftoppm -png -r 300 -f "$p" -l "$p" "src.pdf" "page-$p"
   tesseract "page-$p.png" out -l eng+vie txt tsv   # writes out.txt AND out.tsv
   ```
   - **Parallelize with `OMP_THREAD_LIMIT=1`.** Tesseract's OpenMP spawns several threads per process;
     left unset, running many pages at once oversubscribes the CPU and crawls. Cap each process to one
     thread and fan out N processes (`seq … | OMP_THREAD_LIMIT=1 xargs -P 14 …`) — dramatically faster.
   - **Use the TSV output for TABLES.** The `tsv` config gives per-word bounding boxes
     (`left top width height conf text`), which is what makes column/row reconstruction possible; the
     `txt` config is fine for free-text pages and for classifying pages.
   - **Vietnamese-diacritic OCR is noisy** (wrong/lost tone marks, `đ`↔`d`, merged spaces). Expect it;
     do only *light, non-LLM* cleanup at parse time. Do NOT hand-author the un-enriched rows — Claude
     fixes the first N during enrichment; the rest stay as seeds for a later batch.
3. **Reconstruct bordered tables from the TSV** (the hard part). Gotchas that actually worked:
   - **Rows via anchors, not rule lines.** Horizontal rules are often faint/missed by line detection.
     Instead use the leftmost numbering column (a "STT"/index integer in the left gutter) as the row
     anchor: each such integer marks a new row; bucket words into the y-band up to the next anchor.
   - **Columns via the per-line largest gap.** Detecting the vertical rule with OpenCV also misses
     faint lines; more robust is to split each visual line at its largest horizontal whitespace gap
     (the real column gutter). English left of the cut, L1-meaning right.
   - **Truncate the English term at the first diacritic-bearing token.** English terms are pure ASCII,
     so once a token carries an L1 diacritic the rest is meaning that bled into the term column — cut
     there and move the remainder to the meaning. This one rule fixes most column bleed.
   - **Classify pages by markers** to keep only the vocab tables: a header phrase (e.g. "…
     Collocations"/"… meanings") starts a table; an "Exercise"/"Question" marker ends it. Extract only
     from table pages + the one spill page, so question/answer pages don't pollute the term list.
   - Drop OCR-garbage terms with a character-class filter (letters + `'/&(),.-` only; reject stray
     diacritics or symbols in the *term*). Handle "X = Y" synonym notation by keeping the primary form.

## 1B. Acquire + parse a web-page source

1. **Fetch the page** (WebFetch, or `curl`/`node` to save the HTML). No OCR.
2. **Parse its vocab table/list from the HTML** — rows/cards usually expose columns directly (term,
   IPA, part of speech, meaning), often **grouped by CEFR or IELTS band** (headings like B1/B2/C1/C2).
   Extract straight from the DOM/text; there is no column-reconstruction problem here.
3. **A source may already provide fields Lexi needs — map them straight in, don't re-author them.**
   If the page carries IPA / part of speech / meaning, seed those columns from the page. If it carries
   a **CEFR/IELTS band, map it onto `difficulty`** rather than guessing:
   `B1 → 5.0`, `B2 → 6.0`, `C1 → 7.0`, `C2 → 8.0` (adjust to the source's own scale). Claude-authored
   enrichment then only fills what the source **lacks** (synonyms, collocations, extra examples,
   fuller definition), and *verifies* what it provided.
   *(Worked example shape: a vocabulary web page at `https://example.com/vocab` listing ~800 words with
   IPA + part of speech + meaning grouped into CEFR bands — parse the list, map the band to
   `difficulty`, seed the rest.)*

**Both front-ends** end the same way: a deduped list of `{ word, vi_meaning, and whatever else the
source gave }`, in a sensible order (source order), **deduped by normalized lemma**
(lowercase, strip punctuation and `sb/sth/one's` placeholders).

---

## 2. Build the data pack (`content/collections/<name>.json`)

Follow the `content/collections/*.json` precedent:
```jsonc
{ "collection": { "name": "...", "emoji": "...", "description": "..." },
  "meta": { "note": "First N Claude-authored …; rest seeded …", "total": N, "enriched": N },
  "words": [ { "word", "vi_meaning", "part_of_speech", "ipa", "definition_en",
               "synonyms": [], "collocations": [], "example_simple", "example_complex",
               "false_friend_note", "difficulty" }, … ] }
```
Fields map onto `lib/types.ts`. A **seed-only** word carries just `word` + `vi_meaning` (+ any field
the source gave) and leaves the rest blank/`[]`/`null`. A **fully enriched** word (the first N) carries
everything including `difficulty` (`"5.0" | "6.0" | "7.0" | "8.0" | "9.0"`). Keep provenance out of the
committed pack/script/collection name when the source asks for privacy — use a neutral collection name,
neutral `source` (`manual`), and neutral tags.

---

## 3. Enrich the first N with Claude (fan-out)

Author the first N words' full content with **Claude** — inline for a small N, or fan out to
**general-purpose subagents** in chunks (~15–20 words/chunk, rounds of ~8–10 concurrent) for a large N.
This is the same fan-out shape as `enrich-questions-bank`, but here you author **word content**, not
the 30-question bank.

Give each subagent a chunk file (`OCR_TERM ||| seed_meaning` per line) and have it write a JSON array
(same order, one element per line) with, per word:
`word` (the CORRECTED canonical term — fix OCR merges/typos like `Goonadiet → go on a diet`),
`part_of_speech`, `ipa` (with slashes), `vi_meaning` (**verified and corrected** — never carry a wrong
OCR'd/source meaning verbatim; sources are not fully reliable), `definition_en`, `synonyms` (3–4),
`collocations` (~3), `example_simple`, `example_complex`, `false_friend_note` (or ""), and
`difficulty` (the IELTS band — your judgment: everyday 5.0–6.0, upper-intermediate 6.0–7.0, advanced
7.0–8.0, rare/sophisticated 8.0–9.0). Instruct: **own knowledge only, no web/external API.** Then merge
the enriched first-N over the seed tail into the pack.

---

## 4. Import against a DB COPY (idempotent, additive, blank-safe)

Write an idempotent importer under `scripts/` modeled on `scripts/import-collocations-idioms.mjs`.
Non-negotiables (each learned the hard way):

- **Deterministic word id + reuse.** `id = 'pubcol-w-' + sha1(word.trim().toLowerCase()).slice(0,16)`,
  and REUSE an existing `__system__` word's id (build a normalized-text→id index first). So the same
  term across sources becomes ONE catalog row linked to many collections (`word_collections` with
  `INSERT OR IGNORE`) — never a duplicate — and re-runs are idempotent (`ON CONFLICT(id) DO UPDATE`).
- **Blank-safe upsert.** On conflict, do NOT let an empty/seed value overwrite richer existing content:
  `col = COALESCE(NULLIF(excluded.col, ''), words.col)` for text fields (treat `'[]'` as blank for JSON
  array columns), and preserve `created_at` + `personal_note`. Include the `difficulty` column in the
  SET list. This makes a seed re-import safe over already-enriched rows (and vice-versa).
- **Guard the schema on the copy.** The `words.difficulty` column ships via `migrate()` in `lib/db.ts`
  (`CONTENT_COLS` + a guarded `ADD COLUMN`), but a raw copy may predate it — the importer should run
  the same guarded `ALTER TABLE … ADD COLUMN "difficulty" TEXT` (idempotent) so it works standalone.
- **Public SYSTEM collection.** Upsert the collection with `owner_id = __system__`, `visibility =
  public`; link every word.

Run and verify against a copy — **never** the real or production DB:
```bash
cp .data/lexi.db /tmp/copy.db
DATABASE_URL=file:/tmp/copy.db node scripts/<your-importer>.mjs
# verify: linked count, the public/SYSTEM collection, and N rows with a difficulty band;
# re-run once to confirm counts are unchanged (idempotent).
```

Commit the **importer script + data pack** (the multi-thousand-row DB is gitignored). The pack + script
are what let the same import re-run additively later against dev or prod.

---

## Rules & holds

- **Claude authors all study content** — never an external LLM/API/web, never Lexi's own LLM chain.
- **Never touch the real/production DB.** Work against a copy; applying to production is a separate,
  captain-approved step (an additive migration owned by the operator, not this skill).
- **The 30-question practice bank is a SEPARATE, later step** — do not build it here; see
  `enrich-questions-bank` when a word's bank is wanted. Generating it is a held go/no-go.
- Keep it **idempotent, additive, blank-safe** so re-running never duplicates and never wipes richer
  content. Dedup by normalized lemma. Respect any source-privacy request (neutral names everywhere).
