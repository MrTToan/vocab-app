@AGENTS.md

# Lexi — project guide for Claude

Personal English-vocabulary **practice engine** for one user (intermediate B1–B2, L1 Vietnamese).
Not a notebook: a per-word stage ladder + smart picker + varied, mostly-typed exercises.

**Read for full context:** `PRD.md` (product vision/requirements), `TECH.md` (architecture),
`STATUS.md` (current state, read this first when resuming), `docs/features/` (plain-language,
feature-by-feature guide to how the app behaves), `SETUP.md` + `docs/` (setup: LLM providers, Sheet).
**`CHEATSHEET.md`** = the user's plain-language command reference (run app, review questions, add/enrich
words, back up data) — point the user there when they ask "how do I …".

## Run it
```bash
npm run dev      # http://localhost:3001  (port 3000 is the SEPARATE old ~/coding/vocabulary-app — leave it alone)
```
Next.js 16 (Turbopack, async `params`, no `next lint`). Runs with **no API key** (typed
flashcard/cloze/type + local grading still work); LLM unlocks enrichment + production scoring.

## Tests — the gate (run before calling any change done)
```bash
npm test          # vitest run — MUST be green before a change is considered done
npm run test:watch
```
Covers the pure logic: `lib/engine.ts` (stage ladder, picker, counts), `lib/grade.ts`
(local answer matching — Levenshtein close-match + fuzzy Vietnamese meaning), `lib/ui.ts`,
`lib/spell.ts` (spelling suggestion), `lib/cloze.ts` + `lib/harvest.ts` (bank self-harvesting).
Tests live in `tests/` with a `mkWord` fixture factory. **When you change any of that logic,
update/extend the tests and keep `npm test` passing.** Grading helpers were extracted from the
practice page into `lib/grade.ts` specifically so they're testable — keep them there, not inline.

## Architecture (all behind small modules — don't bypass them)
- **Storage** → `lib/store.ts`. Default = **SQLite/libSQL** file `.data/lexi.db` (the real data lives
  here, gitignored). Optional Google Sheet backend. Picked by env. Tables: `words`, `attempts`, `questions`.
- **LLM** → `lib/providers.ts` + `lib/llm.ts`. Modes: **default** (Anthropic), **custom** (one
  OpenAI-compatible/Anthropic provider), **chain** (`LLM_1_*`, `LLM_2_*`… ordered fallback, 3-strike).
  Structured JSON, Zod-validated. `.env.local` chain: **#1 Gemini → #2 Groq (free) → #3 OpenAI
  (paid, last resort)**; 3-strike failover, recovers on restart.
- **Practice logic** → `lib/engine.ts` (pure): stage ladder + `pickNext` (active-working-set, with an
  `explore` option for the "🔀 new words" toggle) + `exerciseForStage`. **The exercise is chosen by
  `word.stage`**, not by the user.
- **Question bank** → `questions` table, served least-recently-shown via `store.pickQuestion`. Built by
  the `/enrich-questions-bank` skill AND self-harvested from LLM output at runtime (`lib/harvest.ts` +
  `lib/cloze.ts` — fire-and-forget, deterministic-id dedup, no schema change).
- **Types/schemas** → `lib/types.ts`. **UI helpers** → `lib/ui.ts`. **API** → `app/api/*`.

## Conventions & gotchas
- Grading: flashcard/cloze/type graded **locally** (exact + close-match + fuzzy Vietnamese, no LLM);
  write/translate/scenario graded by LLM via `/api/practice/score`. Every graded answer logs an `attempt`.
- When testing DB changes, do it against a **copy** of `.data/lexi.db` (or a temp `DATABASE_URL`),
  never pollute the user's real words/attempts.
- Secrets in `.env.local` only (gitignored); never hardcode keys or echo them in logs.
- Keep PRD/TECH/STATUS (and `CHEATSHEET.md`, `docs/features/`) in sync when behavior changes. When you
  add or change a feature, update its `docs/features/*.md` (or add one + link it in the index).
- User is cost-conscious — state costs, justify dependencies, get sign-off before large LLM runs
  (see the user memory).
- **Claude-authored study content:** synonyms/collocations and the question bank are written by Claude
  (subagents), NOT an external LLM — the user only trusts Claude for that content.
- **Match ceremony to risk:** plan + get sign-off before big/irreversible changes; just do small,
  contained ones. Prefer additive changes and honor "don't touch unrelated parts."
- **Verify before claiming done:** run `npm test` + a live check; report failures honestly, no hedging.
