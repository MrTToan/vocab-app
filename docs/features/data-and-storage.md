# Data & storage

## Where everything lives
Lexi is a **single-user, local** app. All your data sits in one SQLite file: **`.data/lexi.db`**, with
three tables:

- **words** — your vocabulary and each word's progress (stage, times seen, recent results).
- **attempts** — one row per graded answer, powering [Progress tracking](progress-tracking.md).
- **questions** — the [pre-generated + harvested question bank](question-bank.md).

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
