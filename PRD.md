# PRD — Personal English Vocabulary Trainer (working title: "Lexi")

**Owner:** you (single user) · **Status:** ✅ Phase 1 built & in use · **Created:** 2026-08-01

> This PRD is kept in sync with what's actually shipped. For the live state (data,
> providers, known gaps) see `STATUS.md`; for architecture see `TECH.md`.

---

## 1. Problem & goal

Existing vocab apps are glorified notebooks: you log a word, then they show it and ask you
to pick its meaning. That's passive recognition — it doesn't make words stick.

**Goal:** a personal web app that turns your word list into an *active practice engine*. The
LLM enriches each word and generates infinite fresh, in-context material; the practice loop
forces you to **produce English**, in **both directions (VN↔EN)**, resurfaces your **weak/stale**
words, and **varies the exercise type** so no word is ever memorized merely as a test item.

**North star:** *produce English in context · resurface weak & stale words · vary the exercise.*

## 2. User & constraints

- One user (you), intermediate **B1–B2**, L1 Vietnamese.
- **Local first, deploy-ready later** (usable from phone browser once deployed).
- **Storage: SQLite (libSQL)** by default — a local file, zero setup; deploy via Turso.
  Google Sheet is an optional backend (open/edit words in a spreadsheet). *(Changed from the
  original Sheet-first plan after the tech review.)*
- **LLM: provider-flexible & cost-conscious.** Works with Anthropic, or any OpenAI-compatible
  provider (currently Google Gemini), or an ordered fallback chain. App also runs with **no key**.
- **No SRS scheduling** — on-demand practice, but "smart" word selection so it still feels adaptive.
- Not overengineered. Build the core loop well before the nice-to-haves.

## 3. Core concepts

**Word** — a learner-owned entry. Fields (enriched by LLM on add/import):
- `word`, `part_of_speech`, `ipa` (optional), `vi_meaning` (Vietnamese)
- `definition_en` (learner-friendly), `synonyms`, `collocations`
- `example_simple`, `example_complex` (two seed sentences: everyday + richer scenario)
- `false_friend_note` / usage trap (e.g. make vs do) — LLM flags on add
- `personal_note` (your mnemonic / VN hook — editable)
- `tags` (from CSV extra columns), `source` (csv/manual)
- **Progress state:** `stage`, `times_seen`, `recent_results` (last ~5), `last_seen_at`

**Stage ladder (per word):** `New → Recognition → Recall → Production → Known`.
Difficulty ramps with mastery. A **correct or near-miss** answer promotes a stage (capped at
Production); a **wrong** answer demotes one. `Known` (mastery) = **4 non-incorrect answers in a row**,
which retires the word from active rotation.

## 4. Features

> This section captures the original **intent**. For how each feature actually behaves today (in
> plain language), see the **[Feature Guide](docs/features/)**.

### 4.1 Word intake
- **[core] One-time CSV import** — your file has English + extra columns (POS / notes / examples).
  Map columns → keep what you have, LLM fills the gaps (VN meaning, definition, missing examples,
  collocations, false-friend flags). Preview before commit.
- **[core] Add one word (or a pasted sentence)** — type a word; LLM auto-enriches all fields.
  Quick "add a word I just met" flow.
- **[core] Word list / library view** — browse, search, filter (by stage, tag, weak words),
  edit any field, delete.
- **[core] Duplicate validation** — adding a word checks the library (case-insensitive); the Add
  page warns live and the API rejects duplicates (409) unless you explicitly allow one. Imports
  skip words already present.

### 4.2 Enrichment (LLM)
- **[core]** On add/import, generate the field set above in one structured (JSON) call.
- **[core]** Cache 2–3 example sentences per word up front (cost/latency); generate fresh ones
  on demand during practice so exposures vary.

### 4.3 Practice engine — the heart
A session = a mixed queue. The **picker** chooses which word (weighted toward weak/stale, never
repeats a word within a session), and the word's **stage** chooses which exercise. Instant feedback
after every answer. Quit anytime; progress shown as "words getting stronger," never as "cards due."

**The exercise you get is chosen by the word's STAGE** (you don't pick it — the word's progress does):

| Stage | Exercise |
|---|---|
| **New** | 🃏 **Flashcard** — typed & validated (see below) |
| **Recognition** | ␣ **Fill-in-the-blank (cloze)** — target word removed from a sentence; type it |
| **Recall** | ⌨ **Type the word** — given the Vietnamese meaning / EN definition, type the English word |
| **Production** | ✍ **Write a sentence** · 🔁 **Translate** · 🎭 **Scenario/register** — LLM-scored, chosen at random |
| **Known** | occasional brush-up (a Production task) |

A word climbs one stage per **correct or near-miss** answer (capped at Production) and drops one per
wrong answer; **4 non-incorrect answers in a row** masters it to Known and retires it. So exercises get
harder as you climb. (This is why you mostly see Flashcard/Cloze until words climb.)

**Flashcard (New) — typed, two-way, no self-grading, no LLM:**
- **VN→EN:** shows the Vietnamese meaning → type the English word → **exact match** against the DB.
- **EN→VN:** shows the English word → type the Vietnamese meaning → **fuzzy match** against the
  stored meaning (diacritic-insensitive; accepts any comma/semicolon part). Only when it genuinely
  can't match does it show the stored meaning and ask you to confirm — the one place judgment is asked.
- **Close counts:** a small typo scores **"Almost"** (partial), not wrong.

**Production exercises are LLM-scored** (write / translate / scenario) → pass / partial / fail with a
one-line reason + corrected version. Require an LLM provider (Gemini/Anthropic/etc.); without one they
gracefully fall back to Type-the-word.

**[nice-to-have] Roleplay chat** · **[nice-to-have] Cloze story** · **[phase 2] Listening/dictation (TTS)** — *not built yet.*

**Anti-pattern killed:** multiple-choice "pick the meaning" exists in code but is **not used** in the
ladder — every exercise makes you produce or recall, never merely recognize.

### 4.4 Smart selection (no SRS)
Weighted-random picker using only counters — reproduces the *feel* of spacing/interleaving:
```
weight = base
  + weak (last result wrong, or recent accuracy < 60%)
  + stale (not seen in a while)
  − seen already this session   (avoid intra-session repeat)
  − mastered/Known              (occasional brush-up only)
```
Session mixes words and exercise types (interleaving). A word masters to Known after **4 non-incorrect
answers in a row** (near-misses count). Active working set ~35 words.

### 4.5 LLM scoring quality (lesson from LLM-vocab tools)
- Use a **strong reasoning model for grading**, a cheap model for bulk enrichment.
- Force **chain-of-thought + JSON output**; validate the JSON. Weak/lenient grading is the main risk.
- Always return actionable feedback (why + fix), not just a score.

### 4.6 Progress & feedback
- **[built]** Per-word: stage, times seen, recent accuracy; library filters for weak words.
- **[built] Progress page (`/progress`)** — stat tiles (words · practiced · mastered · need-work ·
  attempts · day-streak) plus charts: mastery by stage, **14-day activity** (daily bars stacked by
  result), answer breakdown, **accuracy by exercise type**, most-practiced words. Hand-built SVG/CSS
  (no chart dependency). Backed by an `attempts` log written on every graded answer.
- **No streak-shaming, no due-count dread.**

## 5. Out of scope (for now)
Audio/TTS, speaking/pronunciation scoring, full SRS intervals, multi-user/accounts,
mobile native app, social/sharing, images.

## 6. Phasing
- **Phase 1 (MVP) — ✅ built & in use:** CSV import + add word + enrichment · library (+ duplicate
  validation) · practice engine (flashcard, cloze, type-from-definition, write/translate/scenario
  scored) · stage ladder + smart picker · **progress page**. Runs locally on SQLite.
  *Beyond the original MVP, also shipped:* provider-flexible LLM (Anthropic / OpenAI-compatible /
  Gemini + ordered fallback chain), SQLite/libSQL storage (+ Turso for deploy), typed two-way flashcards.
- **Phase 2 — not yet:** roleplay chat, cloze story, TTS + listening/dictation, deploy (auth + Turso),
  retry/backoff on LLM calls, `engine.ts` unit tests.

## 7. Success criteria
- Adding/importing words feels effortless; enrichment is genuinely useful.
- A practice session never feels like "flip a card, pick a meaning" — it makes you *produce* English.
- Weak words visibly resurface; mastered words fade.
- Cheap enough to run daily without worrying about LLM cost.
