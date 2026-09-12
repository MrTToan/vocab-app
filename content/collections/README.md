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
| Collocations & Idioms | `collocations-idioms.json` | 1,669 | 🧩 Collocations & Idioms |

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

## Collocations & Idioms pack

`collocations-idioms.json` is a larger, phased pack: **1,669** unique collocations/idioms with
Vietnamese meanings. The **first 200** entries are **fully Claude-authored** (part of speech, IPA,
definition, synonyms, collocations, examples, and the `difficulty` IELTS band); the remaining entries
are **seeded** (word + Vietnamese meaning) and await later enrichment batches. Its own idempotent,
**additive**, **blank-safe** importer keeps seed re-runs from ever wiping enriched content:

```bash
# ALWAYS verify on a COPY first — never the real DB.
DATABASE_URL=file:/path/to/copy.db node scripts/import-collocations-idioms.mjs
```

The importer reuses the deterministic `pubcol-w-<sha1(word)>` id scheme (so the same term across packs
is one catalog row linked to many collections), guards the `words.difficulty` column, and upserts every
content field blank-safe (an empty incoming value never overwrites richer existing content). See
`.claude/skills/import-vocab/SKILL.md` for the reusable end-to-end process.
