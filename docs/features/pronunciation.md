# Pronunciation practice — hear it & say it

Two-way pronunciation lives in the **practice reveal** — the review panel shown after you answer,
which already displays the word, its IPA, meaning and an example. Two controls sit there:

- **🔊 Hear it** — plays the word spoken aloud in a natural voice (and the example sentence when the
  word has one), so you know how it should sound.
- **🎤 Say it** — records you saying the word and tells you how you did: a pronunciation **score**
  and a clear **Good / Needs work** verdict with one encouraging line.

Both are optional and non-disruptive: they never change the exercise itself, and they hide themselves
entirely when no speech provider is configured (so a key-less deploy just doesn't show them).

## The two providers (Azure primary, OpenAI fallback)

Speech uses a small provider abstraction (`lib/speech/**`) with **automatic, graceful fallback**:

| | Primary — **Azure Speech** | Fallback — **OpenAI** |
|---|---|---|
| Hear it | Azure **Neural TTS** | OpenAI **TTS** |
| Say it | Azure **Pronunciation Assessment** — real per-syllable **accuracy / fluency / completeness** scores | **Whisper** transcription compared to the target word |
| Coaching signal | a true 0–100 pronunciation score | a *word-match* check (did you say the right word?) — **not** phoneme scoring, and honest about it |

Azure is chosen **first** to burn its generous **free F0 tier** (≈ 0.5M TTS chars + ~5 audio-hours of
assessment per month). Lexi falls back to OpenAI **automatically** when Azure is unconfigured, returns
an error / quota / 429, **or** its tracked monthly free-tier budget is spent. If **neither** provider is
usable the controls degrade gracefully (they hide) rather than erroring.

**The Azure key isn't provisioned yet in production**, so the whole feature runs end-to-end on OpenAI
today; the Azure path activates the moment `AZURE_SPEECH_KEY` + `AZURE_SPEECH_REGION` are set.

## Setup

- **OpenAI (fallback, already wired):** reuses the OpenAI credentials already in the LLM chain
  (`.env.local` — the entry whose base URL is `api.openai.com`). No second key mechanism. If your
  deploy has no OpenAI provider in the chain, the OpenAI speech path is simply unavailable.
- **Azure Speech (primary, optional):** create a **free** resource — portal.azure.com → *Create a
  resource* → **Speech** → pricing tier **Free F0** → after it deploys, **Keys and Endpoint** gives you
  a KEY (either of the two) and the REGION (e.g. `eastus`). Set:

  ```
  AZURE_SPEECH_KEY=<key>
  AZURE_SPEECH_REGION=<region>
  ```

  Optional overrides (voice, models, pass threshold, timeouts, budgets, per-user caps) are documented in
  `.env.example`.

> Deploy env notes also live in the (git-ignored) local `docs/DEPLOY.md`; the committed source of truth
> for these vars is `.env.example` and this page.

## Safety

- **No provider key ever reaches the browser.** The mic recording is uploaded to server routes
  (`/api/speech/tts`, `/api/speech/assess`) that hold the keys and make the provider calls; the client
  only ever gets audio bytes back or a JSON result.
- Both routes are **sign-in-gated and metered** like every other model-calling route (`QUOTA_SPEAK`,
  `QUOTA_PRONOUNCE`) — public users spend the owner's keys.
- **Microphone permission denied / no mic / no MediaRecorder** → a friendly message, never a crash; the
  say-it control simply isn't offered when the browser can't record.
- **Azure free-tier tally.** A per-UTC-month running total of Azure TTS characters and assessment
  seconds is kept in SQLite (`speech_usage`) so the "budget spent → fall back to OpenAI" switch is real.
  It's deliberately approximate — if the tally is ever wrong, Lexi still tries Azure and falls back on
  its own error.

## How "say it" is graded

- **Azure:** the overall PronScore (0–100). At/above `SPEECH_PASS_SCORE` (default **70**) → *Good*, else
  *Needs work*. Accuracy / fluency / completeness are shown underneath.
- **OpenAI:** Whisper transcribes what you said; Lexi normalizes both sides (case/accents/punctuation)
  and accepts an exact hit, the word as a token in a short phrase, or a 1-edit near-miss. There is **no**
  numeric score on this path — it's a did-you-say-the-right-word check, and the UI says so.

---
*Under the hood: `lib/speech/{index,config,azure,openai,usage,wav,match,types}.ts`,
`app/api/speech/{tts,assess}/route.ts`, `components/practice/PronunciationPractice.tsx` (rendered in
`app/(app)/practice/page.tsx`), `speech_usage` table in `lib/db.ts`, tasks `speak`/`pronounce` in
`lib/auth/quota.ts`. Availability is surfaced on `GET /api/config` as `speech:{tts,assess}`.*
