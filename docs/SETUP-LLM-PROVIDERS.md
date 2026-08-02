# Choosing your LLM provider (default vs custom mode)

Lexi uses an LLM for three jobs: **enrich** (fill a word's fields), **generate**
(fresh cloze / translate / scenario), and **score** (grade your written sentences).

You pick how those jobs are powered with a couple of env vars in `.env.local`. All keys
stay server-side — nothing is exposed to the browser. Restart `npm run dev` after any change.

There are two modes.

---

## Default mode — Anthropic (recommended, simplest)

Leave `LLM_MODE` unset (or `default`) and just set your Anthropic key:

```
ANTHROPIC_API_KEY=sk-ant-...
```

This uses **Claude Haiku 4.5** for enrich/generate and **Claude Sonnet 5** for scoring —
cheap, and Sonnet grades strictly (important — weak graders are too lenient). Setup:
[`SETUP-ANTHROPIC.md`](SETUP-ANTHROPIC.md).

---

## Custom mode — any provider you like

Set `LLM_MODE=custom` and configure a provider. Any **OpenAI-compatible** endpoint works,
or Anthropic.

### Simplest custom setup (one provider for everything)

```
LLM_MODE=custom
LLM_PROVIDER=openai
LLM_API_KEY=sk-...
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-4o-mini
```

Common `LLM_BASE_URL` values:

| Provider | `LLM_BASE_URL` | Notes |
|---|---|---|
| OpenAI | `https://api.openai.com/v1` | key `sk-...` |
| OpenRouter | `https://openrouter.ai/api/v1` | one key, hundreds of models (`LLM_MODEL=anthropic/claude-3.5-sonnet`, `openai/gpt-4o`, …) |
| Groq | `https://api.groq.com/openai/v1` | very fast |
| DeepSeek | `https://api.deepseek.com/v1` | cheap |
| Google Gemini | `https://generativelanguage.googleapis.com/v1beta/openai/` | `LLM_MODEL=gemini-2.0-flash` |
| Local Ollama | `http://localhost:11434/v1` | no key needed; `LLM_MODEL=llama3.1` |
| Anthropic | *(use `LLM_PROVIDER=anthropic`, no base URL)* | `LLM_API_KEY=sk-ant-...` |

### Advanced: a different provider/model per task

Per-task vars override the globals. Each task (`ENRICH`, `GENERATE`, `SCORE`) can set its
own `PROVIDER`, `API_KEY`, `BASE_URL`, `MODEL`. Example — cheap local model for enrichment,
but Anthropic Sonnet for the important grading:

```
LLM_MODE=custom

# default for enrich + generate: local Ollama
LLM_PROVIDER=openai
LLM_BASE_URL=http://localhost:11434/v1
LLM_MODEL=llama3.1

# but score with Anthropic
LLM_SCORE_PROVIDER=anthropic
LLM_SCORE_API_KEY=sk-ant-...
LLM_SCORE_MODEL=claude-sonnet-5
```

Resolution order for each field of a task X: `LLM_X_*` → `LLM_*` → (for Anthropic key)
`ANTHROPIC_API_KEY`.

---

## Priority fallback chain (multiple keys/providers)

List providers in **priority order**. The app uses #1; if it fails **3 times in a row**
it **permanently drops** to #2, then #3, and so on — recovering only when you restart.
One global chain applies to every task (enrichment, generation, scoring). This overrides
the single-provider settings above (if any `LLM_1_*` is present, the chain is used).

Add numbered entries in `.env.local` — each is a full provider config:

```
# #1 — Gemini (tried first)
LLM_1_PROVIDER=openai
LLM_1_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai/
LLM_1_API_KEY=<your gemini key>
LLM_1_MODEL=gemini-flash-latest

# #2 — OpenAI (used if Gemini fails 3x in a row)
LLM_2_PROVIDER=openai
LLM_2_BASE_URL=https://api.openai.com/v1
LLM_2_API_KEY=sk-...
LLM_2_MODEL=gpt-4o-mini

# #3 — Anthropic (next fallback)
LLM_3_PROVIDER=anthropic
LLM_3_API_KEY=sk-ant-...
LLM_3_MODEL=claude-sonnet-5
```

Add as many (`LLM_4_*`, `LLM_5_*`, …) as you have keys; numbering is read in order and
stops at the first gap. Each entry uses the same `PROVIDER` / `API_KEY` / `BASE_URL`
(OpenAI-compatible only) / `MODEL` fields as custom mode.

**Behavior (as configured):** strict — a request that fails is *not* auto-retried on the
next provider; it errors, and only the 3rd consecutive failure flips the app to the next
key. Once flipped, it stays there until you restart. The Home page shows the chain with
the active provider marked ✓ (dropped ones struck through).

---

## Verify

- Home page shows a small line like `custom mode · enrich: openai/gpt-4o-mini · score: anthropic/claude-sonnet-5`.
- `GET /api/config` returns the resolved `mode` and per-task `{provider, model}` (never keys).
- Add a word → **Enrich** should fill fields.

---

## Notes & tips

- **Scoring quality matters most.** Use a capable model for `score`; a weak model grades
  too leniently and the practice loses its value. Enrichment/generation can be cheaper.
- **Structured output:** Lexi asks for strict JSON. On OpenAI it uses schema-enforced JSON;
  on other OpenAI-compatible providers it falls back to JSON-object mode with the schema in
  the prompt. If a provider returns malformed JSON, the request errors and is surfaced in the app.
- **Cost:** each provider bills separately at its own rates. See `TECH.md` for the token
  sizes per call so you can estimate.
- Which tasks are ready is independent: if only `score` is configured, flashcards/cloze still
  work and only write-a-sentence/translate/scenario need the scorer; if only enrichment is
  configured, you can enrich words but production exercises fall back to type-the-word.
