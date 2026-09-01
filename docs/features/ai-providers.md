# AI providers — the fallback chain & running with no key

## What the AI is used for
Only two things need AI: **enriching a new word** (drafting meaning, examples, etc.) and **scoring your
written sentences** (write / translate / scenario). Everything else — flashcards, cloze, type-the-word,
and all local grading — works **with no API key at all**.

## The fallback chain
Lexi can try several providers in a set order and automatically fall through when one is unavailable.
Current order:

**#1 Google Gemini → #2 Groq (free) → #3 OpenAI (paid, last resort)**

Every call also **falls through the chain within the same request**: if the active provider errors
(even a one-off network blip), Lexi immediately tries the next one before giving up — so a single hiccup
no longer fails your click. Every call also has a **bounded timeout** (25 s for enrichment/scoring, 60 s
for essay scoring and chart reading); a timeout counts as a failure and falls through like any other.
On top of that, if a provider fails **3 times in a row** with a *transient* error (network error, timeout,
HTTP 408/429/5xx — a 400 or a malformed reply does not count), Lexi advances its *default* starting provider.
It does not stay there for good: after a **5-minute cool-down** (`LLM_RECOVER_AFTER_MS`) the next call probes
provider #1 again and moves back on success. In practice this means the free providers absorb the load and
your paid key is only touched as a last resort — and only for as long as the free ones are actually down.
Error messages shown in the app never include the upstream response or the vendor/model name; the detail is
logged server-side with a short request id. (Chart-reading always prefers the vision-capable provider, skipping any that can't see images.)

Any OpenAI-compatible provider slots in — each is just a `base URL + model + key` in `.env.local`
(`LLM_1_*`, `LLM_2_*`, …). There are also simpler **default** (Anthropic) and **custom** (single
provider) modes.

## Good to know
- The home screen shows which provider is active and whether a fallback has kicked in.
- Out of quota on one provider? Nothing breaks — it just fails over. Add another free provider to the
  chain for more cushion.

---
*Under the hood: `lib/providers.ts` (chain + 3-strike breaker with timed recovery, per-task timeouts/models/reasoning effort), `lib/llm.ts`, `.env.local`, `docs/SETUP-LLM-PROVIDERS.md`.*
