# Lexi

[![CI](https://github.com/MrTToan/vocab-app/actions/workflows/ci.yml/badge.svg)](https://github.com/MrTToan/vocab-app/actions/workflows/ci.yml)

A personal English-vocabulary **practice engine** — *not* a flashcard notebook. Words climb a mastery
ladder, an active-recall picker decides what you drill, and an LLM enriches new words and scores the
sentences you write. Built for one learner (intermediate B1–B2, L1 Vietnamese).

> **Scope, honestly:** a single-user, local-first tool I built for my own study. It's **not deployed**
> and has **no auth by design** — a deliberate choice for a personal app, not an oversight. See
> [Design decisions](#design-decisions--tradeoffs).

## What it does

- **Active-recall practice**, not passive review — every exercise makes you *produce* or *recall*, never
  just multiple-choice recognise. Exercises get harder as a word climbs.
- **Typed, two-way flashcards** validated against the database (no self-grading), plus cloze,
  type-the-word, and LLM-scored writing/translation/scenario tasks.
- **A pre-generated, self-refilling question bank** so questions never repeat.
- **Multi-provider LLM** with an ordered fallback chain, and full **graceful degradation** — the whole
  typed-practice loop works with **no API key at all**.
- **Progress tracking** with hand-built charts (no chart dependency).

Plain-language, feature-by-feature docs live in **[`docs/features/`](docs/features/)**.

## How it works

```mermaid
flowchart LR
  UI["Next.js UI<br/>practice · add · progress"] --> API["API routes<br/>app/api/*"]
  API --> ENG["Pure engine<br/>lib/engine.ts"]
  API --> STORE[("Store interface<br/>SQLite / Google Sheet")]
  API --> LLM["LLM chain<br/>Gemini → Groq → OpenAI"]
  ENG -. "pure & unit-tested" .-> API
```

The domain logic is deliberately **pure and isolated** so it can be unit-tested without a DB or network:
the stage ladder, the weighted picker, answer-matching, and question-harvesting all live in `lib/*` as
side-effect-free functions. Storage and LLM access sit behind small interfaces the app never bypasses.

**The learning model:** words climb **New → Recognition → Recall → Production → Known**. A correct (or
near-miss) answer moves a word up a rung; a wrong one moves it down. **4 non-incorrect answers in a row**
masters a word to *Known* and retires it from rotation. A weighted picker keeps ~35 words in active
rotation, favouring ones you recently got wrong or haven't seen in a while.

## Run it

```bash
npm install
npm run dev        # http://localhost:3001
```

It runs with **no API key** — typed flashcards, cloze, type-the-word and all local grading work fully.
Add a provider to unlock word enrichment and sentence scoring (see
[`docs/SETUP-LLM-PROVIDERS.md`](docs/SETUP-LLM-PROVIDERS.md)). Your data lives in a local SQLite file
(`.data/lexi.db`) and your keys in `.env.local` — both gitignored.

## Tests

```bash
npm run typecheck  # tsc --noEmit
npm test           # vitest
```

Unit tests cover the **pure domain logic** — `engine` (stage ladder, picker, mastery), `grade`
(local answer matching), `spell`, `cloze`, `harvest`, `ui`. The rule of the repo: a change isn't done
until `npm test` is green. *(Honest gap: integration/E2E coverage of the API + practice UI isn't here
yet — the current suite is deliberately the fast, pure core.)*

## Design decisions & tradeoffs

Where I made a call and why — including what I'd want a reviewer to know:

- **SQLite (libSQL), local-first** — single user, zero-ops, instant. The same client points at hosted
  **Turso** with no code change if it ever needs to be online.
- **No spaced-repetition scheduler (no SRS)** — a weighted active-set picker reproduces the *feel* of
  spacing/interleaving using plain counters, without due-date bookkeeping.
- **Streak-based mastery over accuracy thresholds** — I tried a "≥85% over last 5 + ≥8 views" gate
  first; inspecting real data showed it was effectively unreachable, so mastery is now "4 correct in a
  row." Attainable and intuitive.
- **A fallback chain, free tiers first** — Gemini → Groq (free) → OpenAI (paid, last resort); a strict
  3-strike circuit breaker drops to the next provider so a rate-limited free tier never blocks practice.
- **A self-refilling question bank** — good LLM output (model corrections, live-generated exercises,
  enrichment examples) is harvested back into the bank instead of paying to regenerate it.

**Known tradeoffs I'm aware of** (fine at this scale, flagged for honesty):
`pickNext` reads the full word table on each pick (O(n); imperceptible at ~1k words); there's no schema
migration story yet (`CREATE TABLE IF NOT EXISTS`); and the circuit-breaker state is a module global
(correct for one local process, not multi-instance safe).

## Project layout

| Path | What's there |
|------|--------------|
| `lib/` | Pure logic — `engine`, `grade`, `spell`, `cloze`, `harvest` — plus the `store` and LLM `providers` interfaces |
| `app/` | Next.js App Router — pages and `app/api/*` routes |
| `tests/` | Vitest unit tests for the pure logic |
| `docs/features/` | Plain-language guide to how each feature behaves |
| `PRD.md` · `TECH.md` · `STATUS.md` | Product intent · architecture · current snapshot |
| `CHEATSHEET.md` | Everyday commands (run, review questions, back up data) |

## Stack

Next.js 16 (App Router, Turbopack) · React 19 · TypeScript · Tailwind v4 · SQLite/libSQL · Zod ·
Vitest. LLM I/O is structured JSON, Zod-validated.

## License

[MIT](LICENSE)
