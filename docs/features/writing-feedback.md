# IELTS writing feedback — the second module

## What it is
A separate practice module for **IELTS Academic writing**, alongside vocabulary. Two sub-modules:
**Task 1** (describe a chart/graph) and **Task 2** (write an essay). You write a response to a real
prompt and get **one-shot feedback** — no back-and-forth, no repeats.

## What you get back
For every submission, the app shows:
- an **overall band estimate** plus a band for each of the four official IELTS criteria —
  Task Achievement, Coherence & Cohesion, Lexical Resource, and Grammar;
- your writing with **inline highlights** — hover a highlight to see the fix;
- a list of **corrections** (what → what, why), each tagged by error type, with better-word suggestions;
- a summary of your **error types**, your **strengths**, and the single highest-priority thing to improve.

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
Prompts come from documents you collect and drop into `content/writing/task1/inbox/` or
`content/writing/task2/inbox/`. Then ask Claude to run the **`/ingest-writing-prompts`** skill — it
processes them on request (for Task 1 it reads the chart and asks you to confirm the data). A few sample
prompts are seeded so you can start immediately.

---
*Under the hood: `lib/writing/*`, tables `writing_prompts` / `writing_submissions` / `writing_corrections`,
API `app/api/writing/*`, UI `components/writing/*`. Design: `docs/WRITING-SPEC.md`.*
