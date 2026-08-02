# Adding words — enrichment, checks, manual entry, import

## The normal flow (Add page)
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

## Bulk import
**Import CSV** loads a list in one go, de-duplicating against what you already have. Optionally it can
enrich each row via the AI as it imports.

## A note on trust
Some content — synonyms, collocations, and the practice question bank — is authored **by Claude**, not
an outside AI, by design. The per-word AI enrichment above (meaning, examples, etc.) uses your
configured [provider chain](ai-providers.md).

---
*Under the hood: `app/add/page.tsx`, `app/api/enrich`, `app/api/words` (+ `/words/check`), `app/api/import`, `lib/spell.ts`.*
