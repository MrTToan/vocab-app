# Writing module — design spec (IELTS Academic)

**Status:** ✅ built (2026-08-09) · Companion to `PRD.md` / `TECH.md` · This was the design; it now ships.
For how it behaves today see `docs/features/writing-feedback.md`; for architecture see `TECH.md` §4b.

**As-built changes since this design (the doc below is the original plan):**
- **Ingest is ONLINE, not offline.** §4's `.docx`/`.pdf` inbox was replaced by **two Google Docs** (links in
  `content/writing/sources.json`) read via the Google Drive connector. Dedup is by **question number**
  (`Question N` → id `task{1,2}-q<N>`), not a content hash — the user numbers and only appends.
- **In-app ingest, now ADMIN-managed.** Questions are added directly in-app (Task 2 = paste text;
  Task 1 = paste text + chart image; the chart is read **once** by the vision LLM via the provider chain
  — `extract-chart` in `lib/providers.ts` + `lib/writing/extract.ts`, `POST /api/writing/extract-chart` —
  with numbers confirmed before saving; the image is stored **inline as a data URL** in `image_path`, no
  filesystem writes). **As of 2026-09-02 this is admin/owner-only and server-enforced** (`withOwner` on
  `POST /api/writing/prompts` and `PATCH`/`DELETE /api/writing/prompts/:id`): the old self-serve
  `/writing/add` page is retired (redirects) and management moved to the admin portal's **Writing
  Questions** subtab (`components/admin/AdminPortal.tsx`, list via `GET /api/admin/writing-prompts`).
  Regular learners can no longer create/delete questions. The core invariant is unchanged —
  **scoring/practice stays text-only**, reading the stored `chart_data`.
- **Correction spans** are located by exact-substring match in `grade.ts` (LLM returns the verbatim
  `original`; we compute start/end) — more robust than model-provided offsets.
- **Added beyond the plan:** a **question-picker workspace** with per-question past scores + "view last
  feedback"; a **"How to raise your band"** coaching section (`priorities`); **Export PDF** (browser print);
  a Google-Docs-style **side-panel feedback UI**; and `/report` absorbing the full vocab dashboard.

---

## 1. What we're building

A second learning module beside vocabulary: **IELTS Academic Writing practice** with LLM feedback graded
against the official criteria plus the user's own teacher-style guidance.

- **Two sub-modules:** **Task 1** (describe a chart/graph/diagram) and **Task 2** (essay).
- **Core loop:** student reads a prompt → writes an answer → gets **structured, one-shot feedback**:
  the 4 IELTS band scores, inline corrections, synonym suggestions, and a logged error breakdown for review.
- **Standalone for now.** A future vocab↔writing link ("must use 2–3 words you're learning") is designed-for
  but **not built** — we leave the seam, nothing more.

### Non-goals (this phase)
- No revision loop — feedback is **one-shot** (no draft versioning, no resubmit-and-rescore).
- No RAG / vector DB. Guidance is small curated text, injected wholesale.
- No vision model **in the app runtime** (see §4 — vision happens once, at ingest).
- No auth (inherited gap; still required before any public deploy).

---

## 2. Guiding decisions (locked)

| Decision | Choice | Why |
|---|---|---|
| IELTS variant | **Academic** | Task 1 = chart description (not GT letters). |
| Feedback | **One-shot** | Simpler schema; matches how the user studies. |
| Task 1 chart reading | **Vision once at ingest, stored; text-only scoring forever** | One chart is read a single time; thousands of submissions score cheaply against stored data. |
| Vision provider | **Claude, in the ingest skill** (not the app) | Same trust model as the vocab bank ("Claude authors study content"); zero app runtime cost; provider chain untouched. |
| Teacher guidance | **Curated markdown, injected into the scoring prompt** | User's "advice/formulas" grade *by their rules*; no RAG, free, git-tracked, edit-and-go. |
| Reuse | **Storage + LLM chain + progress pattern reused as-is** | The expensive plumbing already exists and is tested. |
| Refactor scope | **Module shell + standalone report only** | No rewrite of `engine.ts`, `store.ts`, or the LLM layer. |

---

## 3. Architecture — additive, not a rewrite

The vocab module already hides storage, LLM, and progress behind small modules; writing reuses all three.
The **only** changes to existing code: (a) slip vocab under a module shell so vocab & writing are peers, and
(b) pull the dashboard into its own cross-skill area.

```
app/
  (shell)            # NEW: nav + layout; vocab & writing as peer modules
  vocab/             # today's practice, moved under the shell (routes keep working)
  writing/
    task1/           # chart-description practice
    task2/           # essay practice
  report/            # NEW: standalone cross-skill dashboard (reads vocab + writing)
  api/writing/*      # NEW: prompts, submit, score
lib/
  store.ts           # reuse + new writing tables
  providers.ts       # reuse AS-IS (no vision needed at runtime)
  llm.ts             # reuse + a writing-score schema/budget
  engine.ts          # UNTOUCHED — vocab-only; essays have no SR ladder
  writing/           # NEW: scoring prompt, error taxonomy, correction spans, guidance loader
content/writing/     # NEW: prompt bank source + guidance (git-tracked)
public/writing/      # NEW: extracted chart images the app displays
```

`engine.ts` stays vocab-only on purpose — writing has no stage ladder or spaced-repetition picker.

---

## 4. Prompt ingestion — one manual skill for both tasks

Prompts come from documents the user finds online and **drops into a directory once**; a **Claude-run ingest
skill** processes them **on request** (like `/enrich-questions-bank`). It is **not** an always-on flow — no
watcher, no daemon; nothing happens until the user runs the skill. Batch up files, then run it once.

```
content/writing/task1/inbox/     # user drops Task 1 chart-question files (.docx/.pdf)
content/writing/task2/inbox/     # user drops Task 2 essay-prompt files
content/writing/{task1,task2}/prompts/   # processed prompts (git-tracked, reviewable)
public/writing/task1/            # committed sample chart(s) only — NOT a runtime store
```

The skill (`/ingest-writing-prompts` or similar) handles **both** tasks:

**Task 2 (text-only):**
1. Extract the **prompt text** from each file.
2. Store one `writing_prompts` row (`task_type=task2`, no image, no `chart_data`).

**Task 1 (adds the vision-once step):**
1. Extract **prompt text** + **chart image** from the file.
2. **Read the chart with vision — once** — into structured `chart_data`
   (`chart_type`, `series`, `key_trends`, `overview`).
3. **User eyeballs it once** (~30s) — it's stored and reused for every future submission, so the facts are
   worth one human glance.
4. Store the chart image **inline** as a `data:` URL in the `writing_prompts.image_path` column,
   together with `chart_data`. Pass the extracted image to `scripts/add-writing-prompt.mjs` via an
   `image_file` (or relative `image_path`) field and it embeds the bytes for you.
   **A stored `image_path` is ALWAYS an inline `data:` URL, never a `/…` path.** Two reasons a
   `/public` path breaks: (a) runtime-written `public/` is rebuilt from the repo on every redeploy, so
   a runtime-written chart is wiped while its DB row keeps a dangling path; and (b) even a *committed*
   `public/` file isn't reliably served in the deployed build — Next lets the request fall through to
   the app HTML shell, so the `<img>` receives `text/html` and breaks. Durable, servable state lives
   only in the `.data` DB volume, and the image route serves the inline bytes. `add-writing-prompt.mjs`
   therefore **embeds even a committed `/public` reference inline** (it reads the file under `public/`
   and stores its bytes) — including the sample (`content/writing/task1/prompts/sample-entertainment.json`
   → `public/writing/task1/sample-entertainment.svg`). The **admin** upload path
   (`components/admin/WritingQuestionsAdmin.tsx`) downscales and encodes the chart as **JPEG** (`q0.85`,
   white-flattened) client-side before storing — a chart is ~5–8× lighter than PNG with text still crisp.

The vision read lives in the ingest skill (which Claude runs) → **zero app-runtime vision cost** and the
provider chain (Gemini→Groq→OpenAI, all text) is unchanged. A fully self-serve, no-Claude ingest would add a
vision API call here later — clean seam, not needed now.

Like enrich-questions-bank, the skill can report what's still un-ingested (files in `inbox/` without a
processed prompt) so re-running only picks up new drops.

---

## 5. Scoring

**Input:** student text + prompt (+ `chart_data` for Task 1) + injected **guidance**.
**Provider:** the existing text chain via `lib/llm.ts` (new `score-writing` task + budget).
**Local pre-check:** word count (Task 1 ≥150, Task 2 ≥250) computed before spending an LLM call.

### Guidance injection (the "teacher's advice" feature)
```
content/writing/guidance/
  general.md          # applies to all scoring
  task1.md task2.md   # task-specific
  lexical.md ...       # optional, per-criterion
```
Relevant files are **prepended to the scoring prompt** so the model grades by the user's rules. Add a formula →
edit a file → next submission uses it. No code change, no cost beyond the prompt text.

### Structured output (Zod-validated, drives the UI)
```jsonc
{
  "overall_band": 6.5,
  "criteria": {
    "task_achievement":        { "band": 6, "comment": "..." },
    "coherence_cohesion":      { "band": 7, "comment": "..." },
    "lexical_resource":        { "band": 6, "comment": "..." },
    "grammatical_range_accuracy": { "band": 6, "comment": "..." }
  },
  "corrections": [
    { "start": 42, "end": 49, "original": "was rise",
      "suggestion": "rose", "error_type": "tense",
      "criterion": "grammatical_range_accuracy",
      "explanation": "Past simple for a completed trend." }
  ],
  "strengths": ["..."],
  "general_feedback": "..."
}
```
- **Inline UI** renders each correction as a highlighted span (`start`/`end` are offsets into the submitted text).
- **Synonyms** ride along as `suggestion` on `lexical`/`word-choice` corrections.
- **Error review** is a query over logged `corrections` grouped by `error_type` — not a separate feature.

### Error taxonomy (fixed enum, extend deliberately)
`article` · `tense` · `subject_verb_agreement` · `preposition` · `collocation` · `word_choice` ·
`spelling` · `punctuation` · `sentence_structure` · `cohesion` · `register` · `task_response`.

---

## 6. Data model (all additive — vocab `words`/`attempts`/`questions` untouched)

- **`writing_prompts`** — `id, task_type (task1|task2), title, prompt_text, image_path?, chart_data? (JSON, Task 1),
  model_answer?, source_file?, tags[], created_at`.
- **`writing_submissions`** — `id, prompt_id, task_type, text, word_count, overall_band,
  band_ta, band_cc, band_lr, band_gra, general_feedback, created_at`. (One-shot → no `parent_id`/versions.)
- **`writing_corrections`** — `id, submission_id, start, end, original, suggestion, error_type, criterion,
  explanation`. Drives inline UI **and** error-review aggregation.

`Store` gains writing methods alongside the vocab ones; backend selection stays env-only.

---

## 7. Report module (standalone, cross-skill)

Pulled out of the vocab-only `/progress` into its own `/report` area that reads **both** modules:
- **Vocab** (existing): mastery by stage, activity, accuracy by exercise.
- **Writing** (new): band trend over time per criterion, **error-type frequency** (top recurring mistakes to
  review), submissions count, average word count, per-task breakdown.

Same hand-built chart approach as today (no chart dependency).

---

## 8. Build order

1. **Module shell** — vocab & writing become peers under `(shell)`; move vocab routes; **keep `npm test` green**.
2. **Task 2 end-to-end** — text-only: submit → structured score → inline feedback UI → error log. Proves the
   whole loop with zero image complexity.
3. **Task 1** — ingest skill (vision-once + `chart_data`) + image display + summary-based scoring.
4. **Standalone report** — cross-skill dashboard reading vocab + writing.

Vocab↔writing link ("forced words") is **designed-for, not built** — seam only.

---

## 9. Open items / to confirm as we build
- Guidance file layout (`general` + per-task now; per-criterion optional) — start minimal, grow on demand.
- Error taxonomy is a first cut; extend as real submissions reveal gaps.
- Auth still unbuilt — a hard prerequisite before any public deploy (inherited from the vocab module).
- Tests: writing scoring's *pure* helpers (word count, span validation, guidance loading, error aggregation)
  go under `tests/` like the vocab logic; the LLM call itself stays at the boundary.
