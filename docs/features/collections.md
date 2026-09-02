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

## Managing them (on **Home**)

The collections manager lives on the **Home** tab (`/vocab`) — it was folded in there during the
nav restructure (the old `/collections` URL now redirects to `/vocab#collections`). Create, rename
(name / emoji / description), and delete collections, and see each one's word count. **Study →**
jumps straight into practising that collection. Deleting a collection removes only the grouping —
the words themselves are kept. (New collections are also created from the **Add** tab, with a
tap-to-pick icon picker.)

## Adding words to a collection

Three ways:

1. **From the Library** — expand a word and toggle its collection chips; or use the
   *Collection* filter at the top to review a collection's members. The filter shows
   **all** of the pack's words — the ones you already study *and* the ones you don't
   yet — so the list always matches the dropdown's count. Words you don't study yet
   carry an **Add** button that starts studying just that one word
   (`POST /api/words/:id/adopt`), the per-word twin of **Add all**.
2. **On the Add page** — pick one or more collections before saving a new word (the selection
   is kept between saves, so you can add several words to the same set in a row).
3. **Claude-curated starter packs** *(on request)* — Claude can author a themed collection
   (the words, collocations, and phrases graders reward) and assign them for you. Ask for one,
   e.g. "build me an IELTS Task 1 collection".

## Public collections

A collection is **private** (only its owner sees it) or **public** (everyone sees it in
their list and on the Practice switcher). Public collections are the shared catalog packs;
only the owner/admin can mark a collection public (the publish toggle on the Home manager, gated
by the `owner` flag from `GET /api/collections`). The shared catalog packs are IELTS Task 1 &
Task 2, Casual English 100, and Academic Writing 100. Practising a public pack works even before
you've "added" it — its words
enter the picker as `new`, and answering them creates your own progress. **Add all** (or
`POST /api/collections/:id/adopt`) bulk-adds the whole pack to your rotation. Either way
**no content is copied** — the words stay shared; only your `user_words` progress is yours.

## Under the hood

`collections` (with `owner_id` + `visibility`) and the `word_collections` join are created
at connect. Access is via the `Store` interface (`collections()` returns your private packs
plus all public ones; `createCollection`, `setCollectionVisibility`, `adoptCollection`,
`setCollectionMembers`, `wordIdsInCollection`, `adoptWord`, …). The practice route asks the
store for `practiceCandidates(collectionId)` — the pack's shared words hydrated with your
progress — then runs the unchanged `pickNext`. Membership edits and publishing are owner-gated
(`ForbiddenError` → 403). See `TECH.md` for the code map.

The **Library list** is server-paginated and server-filtered: `GET /api/words?fields=list`
takes `q` / `stage` / `collection` / `limit` / `offset` and the store's `listPage()` applies
all three filters plus paging in SQL, returning one page (default 60 rows) and the filter's
`total`. When a `collection` is given the source widens to that pack's members (studied +
not-yet-studied, via the same `LEFT JOIN user_words` as the practice picker) with a `studying`
flag per row — which is why the count and the list always agree. `adoptWord(id)` is a
visibility-checked, idempotent per-word `INSERT OR IGNORE` into `user_words` (copies no content;
never touches a word you can't see).
