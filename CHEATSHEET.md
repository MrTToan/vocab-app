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
- **http://localhost:3001**            → home (progress overview)
- **http://localhost:3001/practice**   → practice (this is where the questions appear).
  Tip: the **🔀 Explore new words** button (top-right) swaps your usual review words for random
  new ones you haven't started; press it again to go back to normal review.
- **http://localhost:3001/library**    → all your words
- **http://localhost:3001/progress**   → charts of your results
- **http://localhost:3001/add**        → add a new word

To stop the app: press `Ctrl+C` in the terminal that's running it.

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
| How each feature works (plain language) | `docs/features/` |
| Project status / what's built | `STATUS.md` |
| Full project guide (for Claude) | `CLAUDE.md` |
