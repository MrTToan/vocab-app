# Data & storage

## Where everything lives
Lexi is **multi-tenant** (Google sign-in) and self-hosted; it can also run **local, single-user**
with no auth configured (the dev seam). Everything sits in one SQLite file: **`.data/lexi.db`**
(the same client can point at a hosted Turso DB unchanged). The vocabulary module separates shared
**content** from per-user **progress**:

- **words** — the shared word content (text, meaning, examples, and an optional
  **IELTS target band** — `difficulty`, one of `5.0`–`9.0`, shown as a chip on the Library and
  editable there). `owner_id` marks the public catalog (`__system__`) vs. a user's personal
  word, and gates *editing* only — studying a word is not editing it.
- **questions** — the shared [pre-generated + harvested question bank](question-bank.md),
  keyed by word.
- **user_words** — a user's progress on a word (stage, times seen, recent results). "Studying"
  a word means having a row here; no row means stage `new`.
- **user_question_state** — which bank questions a user has been shown recently.
- **attempts** — one row per graded answer, powering [Progress tracking](progress-tracking.md).
- **users** — accounts (id, email, name), created on first sign-in.
- **collections** + **word_collections** — [collections](collections.md): `owner_id` +
  `visibility` (public/private) and the many-to-many word links.
- **llm_usage** — the per-user daily LLM quota counters (also feeds the [admin](admin.md) dashboard).

The [writing module](writing-feedback.md) adds its own tables to the **same** file: **writing_prompts**
(questions + Task 1 `chart_data`/image, with `owner_id`/`visibility` — public bank vs a user's private prompt), **writing_submissions** (bands + coaching), **writing_corrections**
(inline fixes), and **writing_discussions** (your saved per-card "Discuss with the AI" threads).

Your API keys live separately in **`.env.local`**. Neither file is in version control — they're yours
and local.

## Backups (do this yourself)
Everything important is those two files, so a backup is a copy:

```bash
cp .data/lexi.db ".data/lexi-backup-$(date +%Y%m%d).db"
```

Keep a copy of `.env.local` somewhere safe too, since it holds your keys.

## The public catalog & how catalog data is delivered
The `__system__` public catalog is large — roughly **3,950 words**, each fully enriched (part of
speech, IPA, Vietnamese meaning, English definition, synonyms, collocations, examples, and the
`difficulty` band) and each with a 30-question practice [bank](question-bank.md).

That catalog content is treated as **data, not code**. It is **never committed to git** — the
local seed/enrichment/question-bank packs live under `content/{collections,enrichment,question-bank}/`,
which are **gitignored**. Instead, catalog data is delivered straight to the **production database**
by CLI: back up first, `docker cp` the packs into the app container, then apply them against
`/app/.data/lexi.db` with a raw libSQL script (the importers use deterministic ids and are
idempotent + blank-safe, so re-applying a pack never wipes enriched fields). This keeps the repo
free of bulk vocabulary data while the running app stays the single source of truth for content.

## Other options
- The same code can run against a **Google Sheet** instead of SQLite (optional, chosen by environment
  variables) — handy for a single user who wants words in a spreadsheet. The Sheet backend keeps
  progress inline on the row and does **not** implement the content/progress split or public
  collections, so it's single-user only, not for a multi-tenant deploy.
- For deployment, the SQLite layer can point at a hosted **Turso** database with no code change.

---
*Under the hood: `lib/store.ts` (the storage interface + SQLite/Sheet backends), `.data/lexi.db`.*
