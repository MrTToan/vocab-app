---
name: ingest-writing-prompts
description: Read the user's IELTS writing questions from two Google Docs (one for Task 1 chart questions, one for Task 2 essay prompts) and index them into the app's writing_prompts table. The docs mix text and images (chart screenshots). For Task 1, view each chart ONCE and store its data for reuse. Invoke when the user asks to ingest/index/refresh/sync their writing prompts or questions. Manual, on-request (like enrich-questions-bank), NOT an always-on flow.
---

# Ingest writing prompts for Lexi (from Google Docs)

The user keeps their IELTS Academic writing questions in **two Google Docs** — one for **Task 1**
(chart questions) and one for **Task 2** (essay prompts). Each doc accumulates questions over time and
may mix **text and images** (chart screenshots). This skill reads both docs **on request**, converts each
question into a bank entry, and indexes it into `writing_prompts`. Prompts are curated by **Claude** (you)
— never call an external LLM/API/web to generate content.

Background: `CLAUDE.md`, `docs/WRITING-SPEC.md` (§4), `STATUS.md`.

## The links
The two Google Doc links (or file IDs) live in **`content/writing/sources.local.json`** — this file is
**gitignored** (real links stay off GitHub); read it first. Fall back to the tracked template
`content/writing/sources.json` only if the local file is missing (it will have empty values). Shape:
`{ "task1": "<link>", "task2": "<link>" }`. If a link is blank, tell the user and skip that task.
Extract the file ID from a link like `https://docs.google.com/document/d/<FILE_ID>/edit`.
**Never write a real link into a committed file** (skill docs, the template, prompt JSON, commit messages).

Access is via the connected **Google Drive** tools (`mcp__claude_ai_Google_Drive__*`). The docs must be
accessible to the user's connected Google account (owned by them, or shared/link-viewable). If a read
fails with a permission error, ask the user to share the doc with their connected account.

## The key idea (Task 1): view each chart ONCE
A Task 1 chart is viewed a **single time**, here, into a structured `chart_data`. That data is stored on
the prompt and reused as the scoring ground truth for **every** future submission — so the app never needs
a vision model at runtime, and the same chart is never re-read. Get the facts right once.

## Numbering & incremental dedup (how re-runs stay clean)
The user numbers every question in the doc — **`Question 1`, `Question 2`, …** — and only ever **appends**
(never removes or renumbers old ones). So the question number IS the stable id: `task1-q<N>` / `task2-q<N>`.
Before processing, read which numbers are already indexed and **skip them** — only do the new (higher) ones:
```bash
sqlite3 .data/lexi.db "SELECT id FROM writing_prompts WHERE task_type='task1' ORDER BY id;"
```
This means you don't re-view charts you've already done. (`INSERT OR REPLACE` by id also makes any re-run
idempotent, so no duplicates even if you do reprocess one.)

## 1. Read each doc (text + images)
For each configured task, using its file ID:
1. **Text:** `read_file_content(fileId)` → the natural-language content. Use this to pull the **exact
   prompt statements** and to see the order/structure of the questions.
2. **Images + layout (Task 1, and any Task 2 with images):** export the doc so you can SEE the charts:
   - `download_file_content(fileId, exportMimeType: "application/pdf")` → base64. Save it to your working
     dir and **Read** the PDF to view the charts in context:
     ```bash
     # $WD = your scratchpad dir; write the base64 the tool returned to b64.txt first
     base64 -d "$WD/b64.txt" > "$WD/task1.pdf"
     ```
   - To get the **original screenshot files** to serve in the app, also export DOCX and unzip its media:
     ```bash
     base64 -d "$WD/docx.b64" > "$WD/task1.docx"
     unzip -o "$WD/task1.docx" -d "$WD/task1_x"   # images land in word/media/ in document order
     ```
   - **Size caution:** exports are returned as inline base64. If a doc is large/image-heavy, process it in
     **batches** (a few questions per pass) rather than one giant download. Tell the user what you covered.

## 2. Convert each NEW question to a prompt JSON
Use the question number as the id: `task2-q<N>` / `task1-q<N>`.

**Task 2** (text-only) → one object:
```json
{ "id": "task2-q<N>", "task_type": "task2", "title": "Q<N> · <short title>",
  "prompt_text": "<full prompt, verbatim>", "source_file": "gdoc:task2 Question <N>", "tags": [] }
```

**Task 1** (chart) → for each chart (image `word/media/imageN.png` corresponds to the Nth image in doc order):
1. Copy its screenshot to `public/writing/task1/<slug>.png` (served path `/writing/task1/<slug>.png` → `image_path`).
2. **View the chart** (Read the PNG or the PDF page) and write a faithful `chart_data`
   `{ chart_type, unit, series:[…actual values…], key_trends:[…], overview }` — transcribe every value/label.
3. Build the object:
```json
{ "id": "task1-q<N>", "task_type": "task1", "title": "Q<N> · <short title>",
  "prompt_text": "<full prompt + 'Write at least 150 words.'>",
  "image_path": "/writing/task1/<slug>.png", "chart_data": { … },
  "source_file": "gdoc:task1 Question <N>", "tags": [] }
```
(Complete example: `content/writing/task1/prompts/sample-entertainment.json`.)

Write all the objects for a task to one array file, e.g. `content/writing/task2/prompts/from-gdoc.json`
(git-tracked, reviewable).

## 3. (Task 1) Confirm the data, then store
- **Show the user the extracted `chart_data` for each Task 1 chart and ask them to confirm** it's accurate
  before storing — it's reused forever, so it's worth one glance. Fix anything wrong.
- Store into the bank (idempotent — upserts by id):
  ```bash
  node scripts/add-writing-prompt.mjs content/writing/task1/prompts/from-gdoc.json
  node scripts/add-writing-prompt.mjs content/writing/task2/prompts/from-gdoc.json
  ```

## 4. Verify & report
```bash
sqlite3 .data/lexi.db "SELECT task_type, COUNT(*) FROM writing_prompts GROUP BY task_type;"
```
Report per task: how many questions indexed (new vs. updated), any skipped, and — for Task 1 — that the
user confirmed each chart's data.

## Rules
- **Read from the two Google Docs in `content/writing/sources.json`** — online is the source of truth now.
- **Claude curates only** — never an external LLM/API/web for this content.
- **View each Task 1 chart once**, store `chart_data`, have the user confirm it; the app scores from it
  (no runtime vision).
- **Deterministic ids (content hash)** → re-indexing the whole doc never creates duplicates.
- Keep the converted prompt JSON in `content/writing/*/prompts/` (git-tracked) so indexing is reviewable.
