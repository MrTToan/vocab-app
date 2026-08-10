# Exercise types & how each is graded

Lexi never asks you to grade yourself — every answer is checked against the truth. Two kinds of
checking are used: **local** (instant, no AI) and **AI-scored** (for open-ended writing).

## The exercises
- **Flashcard** *(New)* — two-way and **typed**, not just "flip to reveal":
  - **Vietnamese → English:** you type the English word; it must match exactly (a small typo counts as
    a near-miss).
  - **English → Vietnamese:** you type the meaning; matching is fuzzy (ignores accents/diacritics and
    accepts any part of the stored meaning). If it can't confirm a match, it asks you to self-confirm
    rather than mark you wrong.
- **Cloze** *(Recognition)* — fill the blank in a sentence with the target word. Graded locally.
- **Type the word** *(Recall)* — given the meaning/definition, type the English word. Graded locally.
- **Write a sentence / Translate / Scenario** *(Production, Known)* — you produce English; an AI tutor
  grades it **pass / partial / fail** on grammar, correct use of the word, and naturalness, and shows a
  corrected model sentence.
- **Multiple choice** — defined but currently unused (kept for a possible warm-up mode).

## How local grading decides
- **Exact match** → correct.
- **Close but not exact** (within a small edit distance — an obvious typo) → **partial / "Almost"**, not
  wrong.
- **Too different** → incorrect.

Vietnamese answers are matched **diacritic-insensitively** and against any comma-separated part of the
stored meaning, so "con cho" matches "con chó".

## After every answer
The reveal panel shows the word's learning context — the word, its meaning, an example sentence, and its
**collocations** (the natural word partnerships, e.g. *religious dogma*, *rigid dogma*), so you pick up
how the word is actually used, not just what it means. A false-friend warning shows when the word has one.

Every graded answer is logged for [Progress tracking](progress-tracking.md).

---
*Under the hood: `lib/engine.ts` (`exerciseForStage`), `lib/grade.ts` (local matching), `app/practice/page.tsx`, `app/api/practice/score` (AI scoring).*
