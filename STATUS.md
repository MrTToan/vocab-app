# STATUS — where Lexi is right now (handoff)

_Last updated: 2026-08-09._ Read this first when resuming.

## What this is
Personal English **practice engine** ("Lexi") for one intermediate B1–B2 Vietnamese learner.
**Two modules now:** (1) **Vocabulary** — per-word stage ladder + smart picker + varied, mostly-typed
exercises; (2) **Writing (IELTS Academic)** — Task 1 (chart) + Task 2 (essay) with one-shot LLM
feedback on the four criteria. A SaaS-style **landing page** sits at `/`; the app is split into
`(marketing)` + `(app)` route groups with a cross-skill `/report`. Specs: `PRD.md`, `TECH.md`,
`docs/WRITING-SPEC.md`. Setup: `SETUP.md`, `docs/`. Project guide for Claude: `CLAUDE.md`.

## Writing module (IELTS Academic) — built & verified
- **Two sub-modules:** Task 1 (`/writing/task1`, chart description) + Task 2 (`/writing/task2`, essay).
  Shared loop (`components/writing/WritingPractice.tsx`) + feedback renderer with **inline, numbered
  correction highlights** (`components/writing/Feedback.tsx`).
- **One-shot LLM feedback** on the four official criteria (Task Achievement / Coherence & Cohesion /
  Lexical Resource / Grammar), overall band, inline corrections (located by exact-substring match, pure
  helper), synonym suggestions, and an error-type breakdown. Scoring = new **`score-writing`** task on
  the same provider chain; `maxTokens` 3500.
- **Task 1 reads each chart ONCE** at ingest (Claude's vision → `chart_data`), stored and reused as the
  scoring ground truth — **no vision model at app runtime**. Verified live: a deliberate chart misread
  was caught by the scorer.
- **Teacher's guidance** in `content/writing/guidance/*.md` is injected into every score (no RAG).
- **Storage:** self-contained `lib/writing/store.ts` (libSQL, same `.data/lexi.db`) — tables
  `writing_prompts`, `writing_submissions`, `writing_corrections`. Vocab `Store`/Sheet untouched.
- **Prompt bank:** 5 seeded Task 2 prompts (`scripts/seed-writing-prompts.mjs`) + 1 sample Task 1
  (hand-authored SVG chart). Add more via the **`/ingest-writing-prompts`** skill (drop `.docx`/`.pdf`
  in `content/writing/*/inbox/`, run on request) → `scripts/add-writing-prompt.mjs`.
- **Cross-skill report** (`/report` + `/api/writing/stats`): band trend, per-criterion averages,
  **most-common-mistakes** bar chart, recent submissions — beside the vocab mastery summary.
- **Not connected to vocab yet** (by design) — the "force N vocab words in an essay" link is a seam only.
- **12 unit tests** for the pure writing helpers (`tests/writing.test.ts`); suite is **80/80 green**.

## Built & verified
- **Full app**, typechecks, clean `next build`. Next.js 16 + TS + Tailwind v4.
- **Practice engine** (`lib/engine.ts`, pure): stage ladder new→recognition→recall→production→known;
  active-working-set picker (cycles ~35 words so exercises vary). Mastery is streak-based (4 non-incorrect
  in a row → Known; near-misses count as progress). Exercise is chosen
  by word stage: **New→flashcard, Recognition→cloze, Recall→type-the-word, Production→write/translate/
  scenario** (LLM-scored). Multiple-choice defined but unused.
- **Flashcard = typed, two-way, no self-grading, no LLM:** VN→EN exact-match; EN→VN fuzzy-match
  (diacritic-insensitive, any stored part) with a confirm step only on a genuine miss; close typos → "Almost".
- **Storage = SQLite/libSQL** (`.data/lexi.db`, default). Same client → Turso for deploy. Google Sheet
  optional. One interface `lib/store.ts`. Tables: `words`, `attempts`, `questions`.
- **LLM providers** (`lib/providers.ts`): default (Anthropic) / custom (one OpenAI-compatible or
  Anthropic) / **chain** (`LLM_1_*`,`LLM_2_*`… ordered fallback; after 3 consecutive failures drops to
  the next; recovers on restart). Verified live failover Gemini→Groq→OpenAI. Config is chain mode:
  **#1 Gemini** `gemini-flash-latest` → **#2 Groq** `llama-3.3-70b-versatile` (free) → **#3 OpenAI**
  `gpt-4o-mini` (paid, last resort). Groq is OpenAI-compatible (`api.groq.com/openai/v1`).
- **Duplicate validation:** `/api/words/check`, 409 guard on `POST /api/words` (`allow_duplicate`
  override), Add-page live warning, import dedupe.
- **Spelling suggestion:** enrichment also returns `spelling_suggestion`; the Add page shows a
  "Did you mean X?" banner (accept re-enriches the corrected word). Guarded by pure
  `cleanSpellingSuggestion` (`lib/spell.ts`, unit-tested) — never flags phrases/valid words. No extra
  LLM cost (piggybacks the enrich call); the suggestion is never stored on the Word.
- **Progress page** (`/progress`) + `/api/stats` + an `attempts` log written on every graded answer:
  stat tiles + charts (mastery by stage, 14-day activity stacked by result, answer breakdown, accuracy
  by exercise type, most-practiced). Hand-built (no chart dependency).
- **Question bank** (`questions` table, pre-generated so practice never repeats): cloze/translate/
  scenario, cycled least-recently-shown via `store.pickQuestion`. Authored by Claude subagents
  (`/enrich-questions-bank` skill), 30/word. **~1,119 of ~1,121 words banked** (~33,600 questions,
  ~30/word baseline; the total grows as practice self-harvests). New words added later start with no
  bank — re-run `/enrich-questions-bank` to fill only those.
- **Unit tests** (`npm test`, vitest) cover the pure logic: `lib/engine.ts`, `lib/grade.ts`, `lib/ui.ts`,
  `lib/spell.ts`, `lib/cloze.ts`, `lib/harvest.ts`. **Gate:
  keep `npm test` green on every change** (see CLAUDE.md).
- **Home page** reads `/api/stats` (~1.8 KB) instead of downloading the full word list (~758 KB).
- **Explore mode** on /practice: a "🔀 Explore new words" toggle surfaces random un-started words
  instead of drilling the active working set (`pickNext(..., { explore })` + `explore` flag on
  `/api/practice/next`). Default off — normal spaced repetition is unchanged.
- **LLM-output harvesting** — the bank self-refills from normal use (no extra LLM calls). Shared
  helpers `lib/cloze.ts` (`toCloze`) + `lib/harvest.ts` (builders + deterministic-id dedup via
  `addQuestions`' INSERT OR REPLACE; fire-and-forget `saveHarvest`). Hooks: (1) `/practice/score`
  turns the model's `correction` into a cloze (write_sentence/scenario/translate vn→en); (2)
  `/practice/next` persists live-generated cloze/translate/scenario into the bank; (3) `/api/words`
  seeds cloze(s) from a new word's example sentences. All additive — no schema change.

## Data state
- **~1,128 words** in `.data/lexi.db` (~33,650 bank questions). Writing tables present with the seeded
  prompt bank (6 prompts); submissions/corrections start empty (test data was cleared after verifying).
- Originally imported from `tracker.csv` (`scripts/import-tracker.mjs` split the combined meaning cell,
  no LLM).
- **Cleaned:** 123 meanings had `Input:/Response:`/markdown junk — stripped. 13 sentence-fragment
  "words" deleted; 6 empty meanings filled (incl. `reinder→reindeer`).
- **Enriched:** synonyms + collocations authored by Claude (me + 8 parallel subagents) — collocations
  on 100%, synonyms on the ~1,044 single-word/lexical entries (phrases got collocations only).
- **Still empty by design:** `part_of_speech`, `ipa`, `definition_en`, `false_friend_note` (never
  filled; enrichment was not run over the whole set — only add/import-time enrichment fills these).
- Practice **attempts are logged per graded answer** — progress charts fill from real practice.

## Bug fixed
Thinking models (Gemini flash, Claude) spend reasoning tokens against `max_tokens`; generation's old
400-token budget starved JSON output → silent fallback. Budgets bumped in `lib/llm.ts`
(enrich 2500 / generate 1500 / score 2000). Also: `gemini-2.5-flash` is gated for new keys → use the
`gemini-flash-latest` alias.

## Not yet done / next
- No auth (needed before public deploy). No retry/backoff on LLM calls (a burst can 429 and trip the
  chain). Progress writes per-answer (not batched). Providers circuit-breaker has no unit test yet
  (module state; harder to test than the pure logic).
- Question bank is complete for the current ~1,121 words; only re-run `/enrich-questions-bank` after
  adding new words (it targets only un-banked words).
- Optional: enrich the whole set's empty fields (POS/IPA/definition/false-friend) — costs LLM calls.
- Phase 2: roleplay chat, cloze story, TTS + listening/dictation, deploy (auth + Turso).

## Don't lose
- `.data/lexi.db` (your ~1,121 words — gitignored). `.env.local` (keys — gitignored).
- Distinct from `~/coding/vocabulary-app` (older abandoned attempt; occupies port 3000 — leave alone).
