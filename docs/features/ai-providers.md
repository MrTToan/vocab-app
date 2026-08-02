# AI providers — the fallback chain & running with no key

## What the AI is used for
Only two things need AI: **enriching a new word** (drafting meaning, examples, etc.) and **scoring your
written sentences** (write / translate / scenario). Everything else — flashcards, cloze, type-the-word,
and all local grading — works **with no API key at all**.

## The fallback chain
Lexi can try several providers in a set order and automatically fall through when one is unavailable.
Current order:

**#1 Google Gemini → #2 Groq (free) → #3 OpenAI (paid, last resort)**

If a provider fails **3 times in a row** (e.g. it runs out of daily quota), Lexi drops to the next one
for the rest of the session and recovers on the next restart. In practice this means the free providers
absorb the load and your paid key is only touched as a last resort.

Any OpenAI-compatible provider slots in — each is just a `base URL + model + key` in `.env.local`
(`LLM_1_*`, `LLM_2_*`, …). There are also simpler **default** (Anthropic) and **custom** (single
provider) modes.

## Good to know
- The home screen shows which provider is active and whether a fallback has kicked in.
- Out of quota on one provider? Nothing breaks — it just fails over. Add another free provider to the
  chain for more cushion.

---
*Under the hood: `lib/providers.ts` (chain + 3-strike breaker), `lib/llm.ts`, `.env.local`, `docs/SETUP-LLM-PROVIDERS.md`.*
