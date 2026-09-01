# Public vocabulary collections (seed content)

Curated, **Claude-authored** vocabulary packs published as **public / SYSTEM-owned** collections
(`owner_id = __system__`, `visibility = public`). Every user sees and can *study* them; only the
owner/admin may *edit* them. Studying/adopting copies no content — it just creates the studier's
per-user progress rows (`user_words`). See `lib/auth/user.ts` and `lib/store.ts`.

## Files

| Pack | File | Words | Collection (emoji) |
|------|------|-------|--------------------|
| IELTS Task 2 | `ielts-task2.json` | 68 | 📝 IELTS Task 2 |
| Casual English 100 | `casual-100.json` | 105 | 💬 Casual English 100 |
| Academic Writing 100 | `academic-100.json` | 100 | 🎓 Academic Writing 100 |

- Each pack file is `{ "collection": {name, emoji, description}, "meta": {...}, "words": [...] }`.
  A word maps onto the `EnrichableFields` of the `Word` shape (`lib/types.ts`). **`ipa` is
  intentionally left blank.** `category` is metadata (used as a tag).
- `questions/*.out.json` — the pre-generated question banks (10 cloze + 10 translate + 10 scenario
  per word = **8,190** questions total), keyed by the exact word text.

The three packs are strictly **disjoint** — no word appears in more than one pack.

## Ingest (one-time deploy step)

`scripts/ingest-public-collections.mjs` is **idempotent** (deterministic ids + upserts). It requires
the content/progress-split schema, so run the migration first on any pre-split DB. Against the **live**
DB this is a one-time deploy step (re-running never duplicates):

```bash
# ALWAYS verify on a COPY first — never the real DB.
DATABASE_URL=file:/path/to/copy.db node scripts/migrate-content-split.mjs
DATABASE_URL=file:/path/to/copy.db node scripts/ingest-public-collections.mjs
```

For each pack it upserts the words as SYSTEM content, creates/updates the public collection, links the
words, and replaces each word's question bank. It also **promotes the existing `IELTS Task 1`
collection** to public/SYSTEM (its words are already SYSTEM-owned after the migration).
