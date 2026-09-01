# Data & storage

## Where everything lives
Lexi is a **single-user, local** app. All your data sits in one SQLite file: **`.data/lexi.db`**. The
vocabulary module separates shared **content** from per-user **progress**:

- **words** — the shared word content (text, meaning, examples). `owner_id` marks the
  public catalog (`__system__`) vs. a user's personal word, and gates *editing* only.
- **questions** — the shared [pre-generated + harvested question bank](question-bank.md),
  keyed by word.
- **user_words** — your progress on a word (stage, times seen, recent results). "Studying"
  a word means having a row here; no row means stage `new`.
- **user_question_state** — which bank questions you've been shown recently (per user).
- **attempts** — one row per graded answer, powering [Progress tracking](progress-tracking.md).

The [writing module](writing-feedback.md) adds its own tables to the **same** file: **writing_prompts**
(questions + Task 1 `chart_data`/image), **writing_submissions** (bands + coaching), **writing_corrections**
(inline fixes), and **writing_discussions** (your saved per-card "Discuss with the AI" threads).

Your API keys live separately in **`.env.local`**. Neither file is in version control — they're yours
and local.

## Backups (do this yourself)
Everything important is those two files, so a backup is a copy:

```bash
cp .data/lexi.db ".data/lexi-backup-$(date +%Y%m%d).db"
```

Keep a copy of `.env.local` somewhere safe too, since it holds your keys.

## Other options
- The same code can run against a **Google Sheet** instead of SQLite (optional, chosen by environment
  variables) — handy if you want your words in a spreadsheet.
- For deployment, the SQLite layer can point at a hosted **Turso** database with no code change.

---
*Under the hood: `lib/store.ts` (the storage interface + SQLite/Sheet backends), `.data/lexi.db`.*
