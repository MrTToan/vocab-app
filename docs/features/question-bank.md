# The question bank — pre-generated & self-refilling

## What it is
So you never see the same question twice (and can't just memorise answers), Lexi keeps a **bank of
ready-made questions** for each word — **30 per word**: 10 cloze, 10 translate, 10 scenario. During
practice it serves the **least-recently-shown** one, so questions rotate and stay fresh.

## Where the questions come from
1. **The enrich skill (bulk).** Running `/enrich-questions-bank` has Claude author the full 30-per-word
   set for any words that don't have a bank yet. This is the one-time fill for your existing vocabulary.
   Questions are written **by Claude**, not an outside AI — that's a deliberate quality/trust choice.
2. **Self-refill (automatic).** The bank also **grows from your normal use**, reusing good English the
   app already produces — at no extra cost:
   - the AI tutor's **corrected sentence** after a writing exercise → becomes a new cloze;
   - any **live-generated** cloze/translate/scenario → saved instead of thrown away;
   - a new word's **example sentences** → seeded as cloze the moment you add it.

Duplicates are prevented automatically, so the same sentence is never stored twice.

## Good to know
- A **newly added word starts with no bank** — it fills in as you practise it, and fully when you next
  run the enrich skill.
- To see any word's bank in plain text: `node scripts/show-questions.mjs <word>` (see `CHEATSHEET.md`).

---
*Under the hood: `questions` table + `store.pickQuestion`, `lib/harvest.ts` + `lib/cloze.ts` (self-refill), `.claude/skills/enrich-questions-bank` (bulk).*
