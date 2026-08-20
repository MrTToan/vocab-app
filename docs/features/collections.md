# Collections

**Collections** are named, curated groups of words — a study *lens* for practising a
specific need (e.g. an "IELTS Task 1" set of trend verbs, data nouns, and sentence frames)
instead of drilling your whole vocabulary.

## What they do

- **Many-to-many.** A word can live in several collections at once (e.g. both "IELTS Task 1"
  and "Business"). Collections are separate from the free-text **Tags** field — tags describe
  a word; collections are deliberate study sets you pick to practise.
- **Scoped practice.** On the **Practice** page a *Studying* dropdown lets you pick a
  collection. When one is active, the picker only draws from that collection's words —
  **the stage ladder and spaced-repetition engine are unchanged**, just pointed at a smaller
  pool. Your choice is remembered across sessions; the default is **All words**.
- **Progress stays global.** A word has one stage everywhere. Drilling "surge" inside your
  Task 1 collection advances it in every collection and in All words too — collections never
  fork a word's progress.

## Managing them (`/collections`)

Create, rename (name / emoji / description), and delete collections, and see each one's word
count. **Study →** jumps straight into practising that collection. Deleting a collection
removes only the grouping — the words themselves are kept.

## Adding words to a collection

Three ways:

1. **From the Library** — expand a word and toggle its collection chips; or use the
   *Collection* filter at the top to review a collection's members.
2. **On the Add page** — pick one or more collections before saving a new word (the selection
   is kept between saves, so you can add several words to the same set in a row).
3. **Claude-curated starter packs** *(on request)* — Claude can author a themed collection
   (the words, collocations, and phrases graders reward) and assign them for you. Ask for one,
   e.g. "build me an IELTS Task 1 collection".

## Under the hood

Two additive SQLite tables — `collections` and a `word_collections` join — created
automatically at connect; existing tables are untouched. Access is via the `Store` interface
(`collections()`, `createCollection`, `setCollectionMembers`, `wordIdsInCollection`, …). The
practice route scopes with the pure `scopeToCollection(words, memberIds)` helper before
`pickNext`. See `TECH.md` for the code map.
