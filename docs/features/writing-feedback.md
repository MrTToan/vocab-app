# IELTS writing feedback — the second module

## What it is
A separate practice module for **IELTS Academic writing**, alongside vocabulary. Two sub-modules:
**Task 1** (describe a chart/graph) and **Task 2** (write an essay). You write a response to a real
prompt and get **one-shot feedback** — no back-and-forth, no repeats.

## Choosing what to practise
Writing isn't spaced-repetition — you decide. Each task page has a **left pane listing every question**
with your **best band so far** (or a "New" tag), so you can pick a fresh one or redo a weak one. If you've
already done a question, a **"View last feedback"** button re-opens your last scored attempt so you can
review it without rewriting.

## Timing yourself like the real exam
The exam gives 60 minutes for both tasks; the rule of thumb is **20 minutes for Task 1, 40 for Task 2**.
A **floating countdown clock** starts in the bottom-right of the writing screen, pre-set to the recommended
time for that task. Press **Start** to begin (Pause/Resume and Reset are there too); it stays pinned as
you scroll, turns amber in the last two minutes, and keeps counting into overtime (shown as `+m:ss`) so
you can see how far past the recommendation you've gone. **Drag it by the ⠿ grip** to move it out of your
way — it remembers where you put it. It resets when you switch questions and never appears in the exported PDF.

**Exam-like writing box:** while you write, the browser's own spell-check and autocorrect are turned off —
catching your own spelling is part of the test, not the browser's job (the app still flags spelling in the
feedback after you submit).

## What you get back
For every submission, the app shows:
- an **overall band estimate** plus a band for each of the four official IELTS criteria —
  Task Achievement, Coherence & Cohesion, Lexical Resource, and Grammar;
- your writing **annotated Google-Docs-style** — the essay on the left, compact correction notes on the
  right; hover or click a highlight and its note lights up (and vice versa). **Click to pin** a note and it
  **stays open and locked** — moving your cursor no longer switches or collapses it — until you click again
  to unpin;
- each correction shows *what → what*, the error type, and why, with better-word suggestions;
- **"How to raise your band"** — 2–3 *prioritised, higher-order* improvements (not the small fixes):
  the strategic weaknesses capping your score, each with **why** (specific to your essay), **how** (a
  technique), and a **model sentence** to emulate;
- a summary of your **error types** and your **strengths**.

**Export PDF:** an *⬇ Export PDF* button turns the whole report into a PDF (via your browser's Save-as-PDF)
you can save or send.

The four criteria, the corrections, and the error tags all feed the **Report** page (`/report`), so you
can see your band trend and your most common mistakes over time.

## Discuss any feedback with the AI
Each feedback card — the **four criterion scores**, each **"How to raise your band"** coaching point, and
each **inline correction** — has a **"💬 Discuss with the AI"** thread. Open it, ask *why* you got that
band, ask for a rewrite, or push back — the AI tutor answers grounded in your actual essay, the prompt,
and that specific piece of feedback. It's **multi-turn** (ask follow-ups) and **saved**: reopen the
submission later via "View last feedback" and your conversations are still there. If the card feels
cramped, hit **⤢ Expand** to open the thread in a **large centred pop-up** (Esc or click outside to close).
_Each message is one LLM call on your provider chain. Under the hood: `lib/writing/discuss.ts`,
`app/api/writing/discuss`, table `writing_discussions`, component `components/writing/CardDiscussion.tsx`._

## How the grading works
- Scoring is done by the LLM (it needs a provider configured — same as vocabulary production scoring).
- It grades by the official IELTS descriptors **plus your own teacher's rules**: anything you put in
  `content/writing/guidance/*.md` is fed into every score. Add a formula → next submission uses it.
- **Task 1 charts are read once.** When a chart prompt is added, the chart is read a single time and its
  data stored; scoring then checks your description against that stored data. So if you misread the chart,
  the feedback catches it — and the app never needs to "see" images while you practise.

## Getting prompts in — admin-managed
Writing questions are an **admin-managed bank**: only the **site owner/admin** can add, edit,
delete or publish them, and this is **enforced server-side** (`POST /api/writing/prompts` and
`PATCH`/`DELETE /api/writing/prompts/:id` are `withOwner`), not just hidden in the UI. Learners
pick from the bank; they no longer create their own questions (the old self-serve `/writing/add`
flow is retired and now just redirects).

Admins manage everything from the admin portal's **Writing Questions** subtab (`/admin?tab=writing`):
one combined Task 1 / Task 2 list with search + task/publish-state filters, and add / edit /
delete / publish. For Task 1 the admin adds the **chart image** (paste, drag-drop, or pick a file);
the app reads the chart **once** via the vision LLM, shows the numbers to confirm/edit, then stores
everything inline (no files to manage). Those numbers are the ground truth descriptions are scored
against. Limits: question text 10–4,000 characters, title up to 120, chart image PNG/JPEG/WebP up
to 1 MB (Task 1 only). See `docs/features/admin.md` for the subtab UI.

### Who sees a question
Prompts have an **owner and a visibility**, exactly like collections:
- The bank is owned by the shared catalog (`owner_id = __system__`). A **published** question
  (`visibility = public`) is what every learner practises from; a **draft** (`visibility = private`)
  is hidden from learners and visible only to the admin, who publishes it deliberately after review.
- Every learner prompt read is filtered to *public or the admin's own bank*, so scoring/discussing
  against an unpublished draft by id is not possible for a learner.
- Deleting a question keeps everyone's past feedback on it.

**Adoption migration (schema v2):** questions that regular users had created before this became
admin-only were **adopted into the bank as drafts** — their `owner_id` became `__system__` and
their `visibility` was forced to `private` (never auto-published), with the original author kept in
`user_id`. No row was deleted; an admin publishes each after review.

**Bulk / legacy — from Google Docs:** the admin can instead keep **two Google Docs** — one for Task 1,
one for Task 2 — with each question **numbered `Question 1`, `Question 2`, …** (Task 1 questions include
the chart as a pasted screenshot). The doc links live in `content/writing/sources.json`. Ask Claude to run
the **`/ingest-writing-prompts`** skill and it reads the docs on request, indexing only the new numbers (so
re-running never duplicates); for Task 1 it reads each chart once and asks you to confirm the figures.
A few sample prompts are seeded so you can start immediately.

---
*Under the hood: `lib/writing/*`, tables `writing_prompts` (with `owner_id`/`visibility`) /
`writing_submissions` / `writing_corrections`, API `app/api/writing/*` — the prompt list omits image bytes
(`has_image`); the selected chart loads from `GET /api/writing/prompts/:id/image` (browser-cached, private).
Admin management: owner-only `GET /api/admin/writing-prompts` (whole bank) + `withOwner`
`POST /api/writing/prompts` (create) and `PATCH`/`DELETE /api/writing/prompts/:id` (edit content +
publish / remove); UI `components/admin/WritingQuestionsAdmin.tsx`, learner UI `components/writing/*`.
Design: `docs/WRITING-SPEC.md`.*
