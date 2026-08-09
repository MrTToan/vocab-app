---
name: ingest-writing-prompts
description: Ingest IELTS Academic writing prompts (Task 1 chart questions and Task 2 essay prompts) that the user has dropped as .docx/.pdf files into the writing inbox, turning each into a bank entry in the app's writing_prompts table. For Task 1, read the chart image ONCE with vision and store its data for reuse. Invoke when the user asks to ingest/process/add their writing prompts or assignments. This is a manual, on-request skill (like enrich-questions-bank), NOT an always-on flow.
---

# Ingest writing prompts for Lexi

Lexi's writing module (IELTS Academic) serves practice prompts from the `writing_prompts`
table. The user collects prompts as documents online and drops them into an inbox; this skill
processes them **on request** into bank entries. Prompts are authored/curated by **Claude**
(you) — do not call an external LLM/API/web to generate them.

Background if needed: `CLAUDE.md`, `docs/WRITING-SPEC.md` (§4 is this workflow), `STATUS.md`.

## The key idea (Task 1): read the chart ONCE
A Task 1 chart is read a **single time**, here, with your own vision, into a structured
`chart_data`. That data is stored on the prompt and reused as the ground truth for scoring
**every** future submission — so the app never needs a vision model at runtime, and the same
chart is never re-read. Spend the care here; get the facts right once.

## Folders
```
content/writing/task1/inbox/     # user drops Task 1 chart-question files (.docx/.pdf/images)
content/writing/task2/inbox/     # user drops Task 2 essay-prompt files
content/writing/{task1,task2}/prompts/   # processed prompt JSON (git-tracked, reviewable)
public/writing/task1/            # extracted chart images the app serves to the student
```

## 1. Find what's pending
List files in the inboxes that don't yet have a processed prompt JSON:
```bash
ls -1 content/writing/task1/inbox/ 2>/dev/null
ls -1 content/writing/task2/inbox/ 2>/dev/null
ls -1 content/writing/task1/prompts/ content/writing/task2/prompts/ 2>/dev/null
```
If both inboxes are empty, report "nothing to ingest" and stop. Process only files without a
corresponding processed prompt (match by a slug of the file name).

## 2a. Task 2 (text-only)
For each Task 2 file:
1. Read it (`.docx`: `python3 -c "import docx…"` or unzip+read `word/document.xml`; `.pdf`:
   `pdftotext file - `). Extract the **exact prompt statement**.
2. Write a processed prompt JSON to `content/writing/task2/prompts/<slug>.json`:
   ```json
   { "id": "task2-<slug>", "task_type": "task2", "title": "<short title>",
     "prompt_text": "<the full prompt, verbatim>", "source_file": "<original filename>",
     "tags": [] }
   ```

## 2b. Task 1 (extract image + read chart once)
For each Task 1 file:
1. Read the file. Extract the **prompt statement** and the **chart image**.
   - `.docx`: images live in `word/media/` inside the zip — `unzip -o file.docx -d /tmp/xx`,
     then copy the chart image out.
   - `.pdf`: `pdfimages -png file.pdf /tmp/xx` (or `pdftoppm`).
2. Copy the chart image to `public/writing/task1/<slug>.<ext>`. Its served path is
   `/writing/task1/<slug>.<ext>` (this becomes `image_path`).
3. **Read the chart with your vision** (open the extracted image with the Read tool) and write
   a faithful `chart_data`:
   ```json
   { "chart_type": "bar|line|pie|table|map|process",
     "unit": "…", "series": [ … the actual data points … ],
     "key_trends": [ "3–5 accurate, comparison-focused observations" ],
     "overview": "one-sentence summary of the main pattern" }
   ```
   Be exact — transcribe every value/label you can read. This is the scoring ground truth.
4. **Show the user the extracted `chart_data` and ask them to confirm** it's accurate (30-second
   check). It's stored and reused forever, so it's worth one human glance. Fix anything wrong.
5. Write the processed prompt JSON to `content/writing/task1/prompts/<slug>.json`:
   ```json
   { "id": "task1-<slug>", "task_type": "task1", "title": "<short title>",
     "prompt_text": "<full prompt + 'Write at least 150 words.'>",
     "image_path": "/writing/task1/<slug>.<ext>", "chart_data": { … },
     "source_file": "<original filename>", "tags": [] }
   ```
   (See `content/writing/task1/prompts/sample-entertainment.json` for a complete example.)

## 3. Store into the bank
Run the storage script on each processed JSON (or pass an array file):
```bash
node scripts/add-writing-prompt.mjs content/writing/task1/prompts/<slug>.json
```
It upserts by `id` (idempotent — safe to re-run) into `writing_prompts` in `.data/lexi.db`
(or `DATABASE_URL`). Test DB-affecting changes against a copy if unsure.

## 4. Verify & report
```bash
sqlite3 .data/lexi.db "SELECT task_type, COUNT(*) FROM writing_prompts GROUP BY task_type;"
```
Report: how many prompts ingested per task, and (Task 1) that the user confirmed each chart's data.

## Rules
- **Claude authors/curates only** — never an external LLM/API/web for this content.
- **Read each chart once**; store `chart_data`; the app scores from it (no runtime vision).
- **Always have the user confirm Task 1 `chart_data`** before storing — accuracy is reused forever.
- Keep processed prompt JSON in `content/writing/*/prompts/` (git-tracked) so ingestion is reviewable
  and re-runnable.
