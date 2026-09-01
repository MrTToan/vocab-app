# Technical Architecture — Lexi (Personal Vocab Trainer)

**Status:** reflects what's built · Companion to `PRD.md`

---

## 1. Stack

| Layer | Choice | Notes |
|---|---|---|
| **Framework** | **Next.js 16** (App Router) + React 19 + TypeScript | One repo, one `npm run dev`; API routes keep keys server-side. **Self-hosted** via Docker (`next start`) — see `Dockerfile`/`docker-compose.yml`. |
| **Styling** | **Tailwind v4** | Responsive; light/dark via CSS variables. |
| **Storage** | **SQLite via libSQL** (`@libsql/client`) — default | File `.data/lexi.db`, persisted via a Docker volume on the self-host box (no Turso needed; the same client can target Turso if ever wanted). Google Sheet is an optional backend. Behind one interface: `lib/store.ts`. |
| **LLM** | **Provider abstraction** (`lib/providers.ts`) | Anthropic SDK **or** any OpenAI-compatible HTTP endpoint; single provider or an ordered fallback chain. |
| **Validation** | **Zod** (`lib/types.ts`) | Validates every LLM output at the boundary. |

Rejected Python/FastAPI (two processes). Next.js full-stack is the least moving parts.

## 2. Storage (`lib/store.ts`)

One `Store` interface, selected by env.

**Content vs progress (the core split).** A word is two kinds of fact:
- **CONTENT (shared once):** the word text/meaning/examples/`personal_note`/`tags`
  and its question bank. Stored once, no per-user duplication. `words.owner_id`
  is `__system__` for the public catalog or a user id for a user's personal word;
  it gates **editing only** — content is otherwise global.
- **PROGRESS (per user):** `user_words(user_id, word_id, stage, times_seen,
  recent_results, last_seen_at, added_at)` is the *only* per-user vocab progress.
  "Studying a word" = having a row here; **no row ⇒ stage `new`**. Per-user
  question recency lives in `user_question_state(user_id, question_id, last_shown)`.

The store JOINs the two and **hydrates each `Word.stage`/progress before the pure
engine** (`lib/engine.ts`) ever sees it — the engine stays content-agnostic.

- **`SqliteStore` (default)** — libSQL. `url = DATABASE_URL` or `file:.data/lexi.db`;
  `DATABASE_AUTH_TOKEN` for Turso. Tables: `words` (shared content + `owner_id`),
  `questions` (shared bank, keyed by `word_id`), `user_words` + `user_question_state`
  (per-user progress/recency), `attempts` (`ts, word_id, exercise_type, result, user_id`),
  and the collections pair `collections` (+ `owner_id` + `visibility`) + `word_collections`.
  Queries the DB per request (no stale cache — correct on serverless).
- **`SheetStore` (optional)** — Google Sheet via service account. Single-user-local;
  does **not** implement the content/progress split (progress stays inline on the
  row — equivalent for one user) or public collections. Not for multi-tenant deploy.

Both implement `all / get / findByWord / add / addMany / update / setProgress /
remove / logAttempt / attempts / practiceCandidates`, the question-bank methods
`addQuestions / pickQuestion / questionCount / questionWordIds`, and the collections
methods `collections / createCollection / updateCollection / setCollectionVisibility /
removeCollection / adoptCollection / wordIdsInCollection / memberships /
setCollectionMembers / setWordCollections`. Swapping backends is env-only.

**Scoping & authorization.** Call sites never use the raw store — they go through
`getStore().forUser(userId)` (and `writingStore.forUser(userId)`), so per-user
scoping is impossible to forget. The caller is resolved once per request via
`currentUserId()` (`lib/auth/user.ts`), the single auth choke point.
- **Per-user (progress):** `user_words`, `user_question_state`, `attempts`, and
  writing `writing_submissions`/`writing_corrections`.
- **Shared (content):** `words`, `questions`, and `writing_prompts` (one pool).
- **Edit authorization** is *separate from studying*: `canEdit(userId, ownerId)`
  (`lib/auth/user.ts`) lets you edit only content you own; the owner/admin
  (`isOwner` = `DEV_USER_ID`) can additionally edit `__system__` catalog content.
  Studying a word grants **zero** edit rights; the store throws `ForbiddenError`
  (→ 403) on an unauthorized content/collection edit. Copy-on-write for personal
  edits of public words is **deferred**.

`SqliteStore` is the multi-tenant/deploy backend. A per-user daily LLM cap lives in
`lib/auth/quota.ts` (`llm_usage` table).

**Collections** (`collections` + `owner_id` + `visibility`, `word_collections`) are
named, curated word groups — a study *lens*. `GET /api/collections` returns the
caller's **private** collections PLUS all **public** ones; the `/practice` switcher
lists both. The practice route asks the store for `practiceCandidates(collectionId)`
— the collection's shared words hydrated with the caller's progress (unstudied
members appear as `new`, so **public packs are practisable**) — then runs the
unchanged `pickNext` over exactly that set; a word's `stage` stays global. Adopting
a public pack (`POST /api/collections/:id/adopt`) inserts `user_words` rows for its
members and **copies no content**. Only the owner/admin marks a collection public
(system-owned). UI: `/collections` (manage + publish toggle + "Add all"), the
`/practice` switcher (remembered in `localStorage`), assignment from Library + Add.
Feature doc: `docs/features/collections.md`. Migration: `scripts/migrate-content-split.mjs`
(idempotent).

## 3. LLM strategy (`lib/providers.ts`, `lib/llm.ts`)

Six tasks — **enrich**, **generate** (fresh cloze/translate/scenario), **score**, **score-writing**,
**extract-chart** (vision — read a Task 1 chart into `chart_data` at ingest), **discuss-writing**
(follow-up Q&A on a feedback card) — each resolved to a provider. Vision calls pass an optional `images`
(base64) alongside the text prompt; supported on both the Anthropic and OpenAI-compatible paths.

**Modes (env):**
- **default** — Anthropic. Haiku 4.5 for enrich/generate, Sonnet 5 for score. Needs `ANTHROPIC_API_KEY`.
- **custom** (`LLM_MODE=custom`) — one provider you choose: any OpenAI-compatible endpoint (`LLM_PROVIDER=openai` + `LLM_BASE_URL` + `LLM_API_KEY` + `LLM_MODEL`) or Anthropic.
- **chain** (numbered `LLM_1_*`, `LLM_2_*`, …) — an **ordered fallback chain**. `callStructured` starts at the
  active provider and **falls through the rest of the chain within the same request**, so a transient blip
  on #1 no longer fails a single call; the **3-consecutive-failure** counter still advances the *default*
  start (#1→#2→#3…, recovers on restart) so a persistently-dead provider isn't retried first every time.
  `callVisionStructured` (used by `extract-chart`) instead always walks from the top so a vision read
  prefers the vision-capable provider even if `activeIndex` advanced for text. One global chain, strict,
  in-memory `activeIndex`/`consecutiveFailures`. Surfaced on Home + `/api/config`.

**Structured output:** Anthropic uses `output_config.format` (json_schema); OpenAI-compatible tries strict `response_format: json_schema`, falling back to `json_object` with the schema embedded in the prompt. Result is always `JSON.parse`d then Zod-validated.

**Thinking-model gotcha:** for "thinking" models (Gemini flash, Claude), reasoning tokens count against `max_tokens` — budgets are set with headroom (enrich 2500 / generate 1500 / score 2000) so JSON output isn't starved.

**Usage log:** every call appends to `.data/usage.jsonl` (task, provider, model, tokens).

**Cost:** provider-dependent; on Gemini-flash / Haiku it's pennies. A full 1,100-word enrichment ≈ ~$1 (or free on Gemini's free tier, subject to rate limits). Scoring an answer ≈ fractions of a cent.

## 4. Data model (`lib/types.ts`)

- **Word:** content `id, word, part_of_speech, ipa, vi_meaning, definition_en, synonyms[], collocations[], example_simple, example_complex, false_friend_note, personal_note, tags[], source, owner_id, created_at` + per-user progress hydrated from `user_words`: `stage, times_seen, recent_results[] (last 5), last_seen_at`. The `Word` shape still carries progress so the pure engine is unchanged; the store fills those fields from `user_words` (defaults to stage `new` when the caller has no row).
- **Attempt:** `word_id, exercise_type, result, ts` — logged per graded answer (powers `/progress`).
- **Question:** `id, word_id, type (cloze|translate|scenario), direction, payload, answer` — the practice bank, pre-generated by the enrich skill and self-harvested from LLM output at runtime (`lib/harvest.ts` + `lib/cloze.ts`).
- **Stage ladder / picker** live in `lib/engine.ts` (pure, unit-testable): `applyResult`, `exerciseForStage`, weighted `pickNext` (active-working-set: cycles ~35 words; streak-based mastery in `applyResult`), `stageCounts`, `recentAccuracy`.

## 4b. Writing module (IELTS Academic)

Additive second module beside vocab; reuses storage + the LLM chain, adds its own domain logic.
- **Routing:** app is split into route groups — **`app/(marketing)`** (full-bleed landing at `/`) and
  **`app/(app)`** (shared nav + centered column). Vocab dashboard moved from `/` to `/vocab`; every
  other vocab URL unchanged. Writing lives at `/writing/{task1,task2}`; cross-skill report at `/report`.
- **Domain (`lib/writing/`)** — `types.ts` (records + Zod/JSON score schema, criteria + error taxonomy),
  `grade.ts` (**pure, unit-tested**: `countWords`, `clampBand`, `normalizeScore`, `locateCorrections`
  = char-span by exact-substring match, error/criterion normalizers), `prompt.ts` (scoring prompt),
  `guidance.ts` (loads `content/writing/guidance/*.md`), `score.ts` (`callStructured("score-writing")`, maxTokens 4500).
- **Storage (`lib/writing/store.ts`)** — its own small libSQL layer over the **same** DB file. Tables:
  `writing_prompts` (`chart_data` JSON + `image_path` for Task 1), `writing_submissions` (four bands +
  `priorities` JSON), `writing_corrections`, and **`writing_discussions`** (per-feedback-card Q&A:
  `submission_id, card_key, role, content, seq`). Kept separate so the vocab `Store` + Sheet backend are
  untouched. Schema evolves via `ALTER TABLE … ADD COLUMN` in a try/catch at connect (e.g. `priorities`).
  Prompts are added via `addPrompts` (respects each prompt's `task_type`) and removed via `deletePrompt`.
  The self-serve add UI (`components/writing/AddPrompt.tsx`) is a segmented Task-1/Task-2 control with an
  explicit active style — the earlier `chip btn-primary` combo lost the CSS cascade to `.chip`, hiding the
  selection and silently filing essays under Task 1.
- **Scoring:** one-shot structured output = overall band + 4 criteria + corrections (`original`,
  `suggestion`, `error_type`, `criterion`, `explanation`) + strengths + `general_feedback` + **`priorities`**
  (2–3 higher-order coaching items: criterion/title/why/how/example). Bands normalized + correction spans
  located in `grade.ts`. Task 1 injects the prompt's `chart_data` as ground truth.
- **Discuss feedback (`lib/writing/discuss.ts`, `/api/writing/discuss`):** every feedback card (criterion,
  coaching point, inline correction) has a **saved, multi-turn** "Discuss with the AI" thread. `card_key`
  (`criterion:<c>` | `priority:<i>` | `correction:<i>`) is resolved to context **server-side** from the
  stored submission; the thread history + prompt + essay are replayed to the `discuss-writing` task. UI:
  `components/writing/CardDiscussion.tsx` (inline + expand-to-modal).
- **Ingest — two paths.** (a) **In-app self-serve** (`/writing/add` → `POST /api/writing/prompts`): paste
  text (Task 2) or text + chart image (Task 1); the chart is read **once** via `extract-chart`
  (`callVisionStructured`) into `chart_data`, shown for confirm/edit, image stored inline as a data URL.
  (b) **Bulk from Google Docs**, manual (`/ingest-writing-prompts` skill): two doc links in
  `content/writing/sources.json`, text via the `mcp__claude_ai_Google_Drive__*` connector, charts via
  DOCX/PDF export, dedup by question number → id `task{1,2}-q<N>`. **Vision runs only at ingest** (either
  path) → `chart_data`; **scoring/practice stays text-only** (no vision at score time).
- **Practice UX niceties:** the essay box disables browser spellcheck/autocorrect (exam-like); the
  exam-pacing **timer is draggable** (position saved in `localStorage`); annotated-essay **pins lock**
  (hover no longer overrides a pinned correction card).
  `scripts/add-writing-prompt.mjs` upserts.
- **UI** (`components/writing/`) — `WritingPractice.tsx` (question-picker workspace + write/result/review),
  `Feedback.tsx` (Google-Docs side panel: annotated essay ↔ compact correction cards, coaching section,
  Export-PDF via `window.print()` + `@media print` in `globals.css`).
- **API:** `GET /api/writing/prompts` (list w/ per-prompt stats, or pick), `POST /api/writing/submit`
  (score + persist), `GET /api/writing/submission?promptId=` (latest attempt for review),
  `GET /api/writing/stats` (report aggregates).
- **Report:** `/report` is the single cross-skill analytics page (vocab dashboard + writing analytics);
  `/progress` redirects to it.

## 5. Project structure
```
vocab-app/
  .env.local              # provider keys + optional storage config (gitignored)
  app/
    layout.tsx            # root document shell only (html/body)
    (marketing)/          # landing route group — full-bleed SaaS page at /
    (app)/                # app chrome (Nav + centered column)
      layout.tsx
      vocab/page.tsx      # vocab dashboard (was /)
      practice/ progress/ library/ add/ import/   # unchanged vocab URLs
      writing/{page,task1,task2}/page.tsx          # IELTS writing module
      report/page.tsx     # cross-skill dashboard
    api/
      config/ words/ words/[id]/ words/check/      # vocab CRUD + dup check
      enrich/ import/ stats/                       # enrich · bulk add · /progress aggregates
      practice/{next,score,result}/route.ts        # picker · LLM grade · apply+log
      writing/{prompts,submit,submission,stats}/route.ts  # bank+stats · score · review · report
  lib/  store.ts providers.ts llm.ts prompts.ts engine.ts types.ts ui.ts
        writing/{types,grade,guidance,prompt,score,store}.ts   # writing module
  components/Nav.tsx  components/writing/{WritingPractice,Feedback}.tsx
  content/writing/     # sources.json (gdoc links) · guidance/*.md · {task1,task2}/prompts/
  public/writing/task1/  # served chart images (extracted at ingest)
  scripts/  import-tracker.mjs  seed-writing-prompts.mjs  add-writing-prompt.mjs
```

## 6. Key flows
- **Import:** client parses CSV → maps columns → chunks to `/api/import` (dedupe; optional per-row enrich).
- **Add:** type word → `/api/enrich` preview (if provider set) → review/edit → save (dup-guarded).
- **Practice:** `/api/practice/next` (picker + stage→exercise; LLM-generates cloze/translate/scenario) →
  answer graded **locally** (flashcard/cloze/type, incl. fuzzy VN + close-match) or via `/api/practice/score`
  (production) → `/api/practice/result` updates stage **and logs an attempt**.
- **Progress:** `/api/stats` aggregates words + attempts → charts.

## 7. Security / secrets
- All LLM + storage calls run in **server-side API routes**; keys never reach the browser.
- `.env.local` gitignored; `.data/` gitignored.
- **Auth (branch `multitenant-deploy`):** NextAuth v5, Google OAuth, JWT sessions.
  Enforced in route handlers via `currentUserId()` (a DAL), **not** middleware —
  this Next 16 deprecated `middleware.ts` (→ `proxy.ts`). Every route rejects
  unauthenticated callers (401) and scopes storage to the session user. Config
  guarded: with no `AUTH_*` env it falls back to the local owner (dev seam).

## 8. Known gaps / next
- No retry/backoff on LLM calls (a burst can trip a provider's rate limit); no
  `engine.ts` unit tests yet; progress writes per-answer (not batched).
- Provider circuit-breaker state is in-memory (`activeIndex`/`consecutiveFailures`).
  Fine when self-hosted (one long-lived process keeps the state); would reset per
  invocation only on serverless — not our deploy model.
