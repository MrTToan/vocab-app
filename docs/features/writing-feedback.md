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

## What you get back
For every submission, the app shows:
- an **overall band estimate** plus a band for each of the four official IELTS criteria —
  Task Achievement, Coherence & Cohesion, Lexical Resource, and Grammar;
- your writing **annotated Google-Docs-style** — the essay on the left, compact correction notes on the
  right; hover or click a highlight and its note lights up (and vice versa);
- each correction shows *what → what*, the error type, and why, with better-word suggestions;
- **"How to raise your band"** — 2–3 *prioritised, higher-order* improvements (not the small fixes):
  the strategic weaknesses capping your score, each with **why** (specific to your essay), **how** (a
  technique), and a **model sentence** to emulate;
- a summary of your **error types** and your **strengths**.

**Export PDF:** an *⬇ Export PDF* button turns the whole report into a PDF (via your browser's Save-as-PDF)
you can save or send.

The four criteria, the corrections, and the error tags all feed the **Report** page (`/report`), so you
can see your band trend and your most common mistakes over time.

## How the grading works
- Scoring is done by the LLM (it needs a provider configured — same as vocabulary production scoring).
- It grades by the official IELTS descriptors **plus your own teacher's rules**: anything you put in
  `content/writing/guidance/*.md` is fed into every score. Add a formula → next submission uses it.
- **Task 1 charts are read once.** When a chart prompt is added, the chart is read a single time and its
  data stored; scoring then checks your description against that stored data. So if you misread the chart,
  the feedback catches it — and the app never needs to "see" images while you practise.

## Getting prompts in
Prompts come from **two Google Docs** you keep — one for Task 1, one for Task 2 — with each question
**numbered `Question 1`, `Question 2`, …** (Task 1 questions include the chart as a pasted screenshot).
The doc links live in `content/writing/sources.json`. Ask Claude to run the **`/ingest-writing-prompts`**
skill and it reads the docs on request, indexing only the new numbers (so re-running never duplicates);
for Task 1 it reads each chart once and asks you to confirm the figures. A few sample prompts are seeded
so you can start immediately.

---
*Under the hood: `lib/writing/*`, tables `writing_prompts` / `writing_submissions` / `writing_corrections`,
API `app/api/writing/*`, UI `components/writing/*`. Design: `docs/WRITING-SPEC.md`.*
