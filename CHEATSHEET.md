# Lexi — command cheat sheet

Everyday commands for running and reviewing your vocabulary app. **Run them from the project
folder** (`/home/toan999/coding/vocab-app`).

> Two ways to run any command below:
> - **Inside a Claude Code chat:** put `!` in front, e.g. `! npm run dev`
> - **In a normal terminal:** type it without the `!`, e.g. `npm run dev`
>   (first do `cd /home/toan999/coding/vocab-app`)

---

## Start / use the app
```bash
npm run dev
```
Then open in your browser:
- **http://localhost:3001**            → landing page (the front door)
- **http://localhost:3001/vocab**      → vocabulary home (progress overview)
- **http://localhost:3001/practice**   → vocabulary practice (where the questions appear).
  Tip: the **🔀 Explore new words** button (top-right) swaps your usual review words for random
  new ones you haven't started; press it again to go back to normal review.
- **http://localhost:3001/writing**    → IELTS writing (Task 1 chart · Task 2 essay)
- **http://localhost:3001/library**    → all your words
- **http://localhost:3001/report**     → cross-skill report (vocab + writing)
- **http://localhost:3001/add**        → add a new word

To stop the app: press `Ctrl+C` in the terminal that's running it.

---

## Practise IELTS writing
- Go to **/writing** → **Task 1** (chart) or **Task 2** (essay). The **left pane lists every question**
  with your past best band — pick one, write your response, press **Submit for feedback**. You get a band
  on all four IELTS criteria, inline corrections (hover/click a highlight to its note), an error
  breakdown, and a **"How to raise your band"** coaching section. Scoring needs an LLM provider.
- Already done a question? Click **"View last feedback"** to re-read it without rewriting.
- **⬇ Export PDF** on the feedback view → your browser's *Save as PDF* → a report you can send out.
- **Add your teacher's advice/formulas** so the examiner grades by your rules: edit the markdown in
  `content/writing/guidance/` (`general.md`, `task1.md`, `task2.md`). Takes effect on the next submit.

### Add writing prompts (questions) — from Google Docs
You keep two Google Docs (one for Task 1, one for Task 2), **numbering each question `Question 1`,
`Question 2`, …** and only ever appending. The doc links live in `content/writing/sources.json`.
1. Add a new numbered question (text, and for Task 1 paste the chart screenshot) to the doc.
2. Ask Claude: **"index my writing prompts"** (or `/ingest-writing-prompts`). It reads the docs, processes
   only the **new** numbers (idempotent), and for Task 1 reads each chart **once** and asks you to confirm
   the figures.
```bash
# quick seed of 5 sample Task 2 essay prompts (idempotent):
node scripts/seed-writing-prompts.mjs
# how many prompts are in the bank, by task:
sqlite3 .data/lexi.db "SELECT task_type, COUNT(*) FROM writing_prompts GROUP BY task_type;"
```

---

## Review the question bank

**See all 30 questions for one word** (cloze + translate + scenario), nicely formatted:
```bash
node scripts/show-questions.mjs pervasive
```
Replace `pervasive` with any word. For a phrase, use quotes:
```bash
node scripts/show-questions.mjs "commemorative plaque"
```

**Get 5 random words to try:**
```bash
sqlite3 .data/lexi.db "SELECT word FROM words ORDER BY RANDOM() LIMIT 5;"
```

**Count things:**
```bash
sqlite3 .data/lexi.db "SELECT COUNT(*) AS words FROM words;"
sqlite3 .data/lexi.db "SELECT COUNT(*) AS questions FROM questions;"
```

Don't like a question? Just tell Claude the word — it can regenerate or delete specific ones.

---

## Add new words later
1. Add them in the app at **/add** (or /import for a CSV).
2. New words start with **no** question bank. To generate questions for just the new ones,
   ask Claude: **“run the enrich-questions-bank skill”** (or type `/enrich-questions-bank`).
   It only touches words that don't have a bank yet.

Check how many words still need questions:
```bash
curl -s http://localhost:3001/api/questions/pending | python3 -c "import sys,json;print(json.load(sys.stdin)['count'],'words need questions')"
```

---

## Keep your data safe
Everything lives in **one file**: `.data/lexi.db` (your words + questions + practice history).
Your API keys live in `.env.local`. Neither is in git — back them up yourself.

**Make a dated backup of the database:**
```bash
cp .data/lexi.db ".data/lexi-backup-$(date +%Y%m%d).db"
```

---

## For maintenance (when changing the code)
```bash
npm test        # run the unit tests — must pass before a change is "done"
npm run build   # production build check
```

---

## Asking Claude for a change (prompt template)
One sentence with these five parts gets it done in the fewest turns:

> **[what]** + **[why/goal]** + **[constraint]** + **[done when]** + **[plan first / just do it]**

Example:
> "Add a shuffle toggle on /practice *(what)* so I stop seeing the same handful of words *(why)*. Keep it
> contained — don't touch storage *(constraint)*. Done when it serves random new words and `npm test`
> passes *(done)*. Just do it, no plan *(ceremony)*."

Tips:
- Refer to earlier things by content, not number ("fix the Home page pulling the whole word list", not
  "fix the second issue").
- When handing over a key/config, say exactly where it is.
- Standing rules (port 3001, tests must pass, cost-conscious, Claude-only content, plan big changes)
  live in `CLAUDE.md` — you don't need to restate them.

## Where things are
| What | Where |
|------|-------|
| Your data (words, questions, history) | `.data/lexi.db` |
| Your API keys | `.env.local` |
| Review-a-word script | `scripts/show-questions.mjs` |
| Question-bank generator (skill) | `/enrich-questions-bank` |
| Writing-prompt ingester (skill) | `/ingest-writing-prompts` |
| Writing question sources (Google Doc links) | `content/writing/sources.json` |
| Your teacher's grading rules | `content/writing/guidance/*.md` |
| How each feature works (plain language) | `docs/features/` |
| Project status / what's built | `STATUS.md` |
| Full project guide (for Claude) | `CLAUDE.md` |
