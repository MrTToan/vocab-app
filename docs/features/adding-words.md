# Adding words — enrichment, checks, single add, import

The **Add** tab has three sub-tabs: **Single word**, **Paste a list** (the primary bulk importer),
and **New collection**.

## Single word (the normal flow)
1. Type an English word or phrase.
2. Press **Enrich →** and the AI drafts the full entry — Vietnamese meaning, an English definition,
   part of speech, IPA, synonyms, collocations, two example sentences, and any "false-friend" warning.
3. **Review and edit** anything, then **Save**. Nothing is saved until you say so.

If no AI key is set, you get **Fill in →** instead and type the fields yourself; everything else works.

## Checks that run before you save
- **Duplicate check (live).** As you type, Lexi looks for a word you already have and shows a warning
  (with a link to it). You can still **Save anyway** if you want a second entry.
- **Spelling suggestion.** If the word looks like a misspelling, a banner offers a correction —
  *"'recieve' looks like a misspelling of 'receive' — Use 'receive'"*. Accepting it re-enriches the
  corrected word; ignoring it keeps your spelling. It never flags real words or intentional phrases.

## Bulk import — paste a list
**Paste a list** is the primary bulk importer. Paste words/phrases separated by newlines and/or
commas; Lexi splits and de-duplicates them and shows a **preview** — how many are new, how many you
already have, and how many were repeats within the paste. Run it and each new word is
**auto-enriched and added** in small chunks with live progress. A single paste is capped
(200 words by default; override with `NEXT_PUBLIC_MAX_PASTE_WORDS`) to protect your daily LLM quota.

**CSV import** is still available as an **Advanced** option folded inside *Paste a list* (expand
"Advanced: import a CSV file"): it maps columns and can enrich each row as it imports. The old
`/import` URL redirects here.

## A note on trust
Some content — synonyms, collocations, and the practice question bank — is authored **by Claude**, not
an outside AI, by design. The per-word AI enrichment above (meaning, examples, etc.) uses your
configured [provider chain](ai-providers.md).

---
*Under the hood: `app/(app)/add/page.tsx` (+ `components/vocab/{AddWord,PasteImport,ImportWords,NewCollection}.tsx`), `app/api/enrich`, `app/api/words` (+ `/words/check`), paste import `lib/paste.ts` + `app/api/words/{check-bulk,import-paste}`, CSV `app/api/import`, `lib/spell.ts`.*
