---
name: enrich-questions-bank
description: Generate the practice question bank (10 cloze + 10 translate + 10 scenario per word) for Lexi vocabulary words that don't have one yet. This is the periodic, manual enrichment of newly added words. Invoke when the user asks to enrich/build questions or "assignments" for their new words. Questions are authored by Claude (inline for ≤30 words, subagents for larger batches — NEVER an external LLM) and stored in the app's `questions` table so practice serves diverse, non-repeating questions.
---

# Enrich the question bank for new words

Lexi (the vocab app in this repo) serves practice questions of three generated types — **cloze**,
**translate**, **scenario** — from a pre-generated bank so the learner never sees the same question
twice and can't just memorize answers. New words the user adds have **no bank yet**; this skill
generates one (**10 questions per type per word = 30/word**), authored by **Claude** from its own
knowledge (the user only trusts Claude for this — do **not** call Gemini/OpenAI/web). Small batches are
authored **inline** by the main agent; only large batches fan out to subagents (see the routing in
step 3) — the trust rule is "Claude authors it," and inline is Claude too.

Background if needed: `CLAUDE.md`, `STATUS.md`, `TECH.md`. Storage is SQLite (`.data/lexi.db`); the
`questions` table is `{id, word_id, type, direction, payload, answer, last_shown}`; practice pulls the
least-recently-shown question per word/type via `store.pickQuestion`.

## Procedure

### 1. Make sure the app is running and find its base URL
The app must be up so its API can read/write the DB. Ask the user to run `npm run dev` if needed
(it usually serves **http://localhost:3001**, since 3000 is held by a separate old project).
Confirm: `curl -s http://localhost:3001/api/config` returns JSON with `"backend"`.

### 2. Get the words that still need a bank
```bash
curl -s http://localhost:3001/api/words > /dev/null   # warms it
curl -s http://localhost:3001/api/questions/pending | python3 -m json.tool
```
`/api/questions/pending` returns `{ count, words:[{id,word,vi_meaning}] }` — exactly the words with no
questions. **If `count` is 0, report "nothing to enrich" and stop.**

### 3. Route by batch size — inline vs. subagents
Subagents carry a large fixed bootstrap cost (their own system prompt + tool schemas, re-billed per
step) that only pays off across many words. For small batches that overhead dwarfs the actual output,
so author inline instead.

- **`count` ≤ 30 → author INLINE (no subagent).** Go to **step 3a**. This is the common case (a handful
  of newly-added words) and is much cheaper — you skip the whole subagent bootstrap and reuse the
  already-loaded main context.
- **`count` > 30 → fan out to SUBAGENTS.** Go to **step 3b** (chunk ≤15/word, rounds of ~8–10).

Either way the author is Claude and the content requirement is identical.

### 3a. Inline authoring (batches ≤ 30 words)
Author the questions yourself, in the main conversation, from your own knowledge — no external
LLM/API/web. For **every** pending word produce the same three sets defined below (10 cloze + 10
translate + 10 scenario, all genuinely varied). Build one JSON object keyed by the EXACT word (verbatim,
as returned by the API), each value `{ "cloze":[...10], "translate":[...10], "scenario":[...10] }`, and
**Write** it to a file in your scratchpad (e.g. `$WD/inline.out.json`). The per-item shapes:

1. `"cloze"`: 10 objects `{ "sentence": "...", "answer": "..." }` — a natural B1–B2 English sentence
   using the word with EVERY occurrence replaced by `"____"`; `answer` = the exact text filling the blank
   (the word or the inflected form you used). 10 distinct sentences.
2. `"translate"`: 10 objects `{ "direction": "...", "source": "..." }` — ~5 `"vn_to_en"` (a Vietnamese
   sentence whose best English translation uses the word) and ~5 `"en_to_vn"` (an English sentence using
   the word). 10 distinct.
3. `"scenario"`: 10 strings — each a short real-life situation WITH a required tone/register in which the
   learner must write an English sentence using the word. Vary situations and registers.

Then apply it (**step 5**) and verify (**step 6**). Skip step 3b/4.

### 3b. Chunk the pending words (MAX 15 per chunk)
**Hard limit: 15 words per chunk.** Each word = 30 questions, so 15 words = ~450 questions ≈ the most
a single subagent can generate reliably (it takes ~4 min). 30 words (900 questions) **stalls** — don't
exceed 15. Pick a working dir (your session scratchpad, or `mktemp -d`). Call it `$WD`.
```bash
mkdir -p "$WD"
curl -s http://localhost:3001/api/questions/pending | python3 -c "
import sys,json,math,os
wd=os.environ['WD']; ws=json.load(sys.stdin)['words']; size=15   # do NOT raise above 15
for i in range(math.ceil(len(ws)/size)):
    c=ws[i*size:(i+1)*size]
    open(f'{wd}/chunk{i+1}.txt','w').write(''.join(f\"{w['word']} | {w['vi_meaning'][:70]}\n\" for w in c))
print('chunks:', math.ceil(len(ws)/size))
"
```

### 4. Launch Claude subagents — one per chunk, in rounds (batches > 30 only)
Use the **general-purpose** subagent. Launch in rounds of ~8 concurrent (send multiple Agent tool
calls in one message). Give each the prompt below, substituting the two absolute paths. **Do not use
an external LLM/API/web — the subagent authors from its own knowledge.**

> You are authoring diverse practice questions for an English-vocabulary app, from your own knowledge.
> Do NOT use web search or any external API.
>
> Read this file: `{CHUNK_FILE}` — each line is `word | vietnamese_meaning` (the meaning gives the sense).
>
> For EACH word produce THREE sets, all genuinely DIFFERENT from each other (varied contexts) so the
> learner can't memorize one:
> 1. `"cloze"`: exactly 10 objects `{ "sentence": "...", "answer": "..." }` — a natural English sentence
>    using the word with EVERY occurrence replaced by `"____"`; `answer` = the exact text that fills the
>    blank (the word, or the inflected form you used). 10 distinct sentences, B1–B2.
> 2. `"translate"`: exactly 10 objects `{ "direction": "...", "source": "..." }` — ~5 `"vn_to_en"` (a
>    Vietnamese sentence whose best English translation uses the word) and ~5 `"en_to_vn"` (an English
>    sentence using the word). 10 distinct.
> 3. `"scenario"`: exactly 10 strings — each a short real-life situation WITH a required tone/register in
>    which the learner must write an English sentence using the word. Vary situations and registers.
>
> Write ONE valid JSON object to `{OUT_FILE}` with the Write tool, keyed by the EXACT word (verbatim,
> left of `" | "`), each value `{ "cloze":[...10], "translate":[...10], "scenario":[...10] }`. Every word
> in the file must be a key. Output only the file; final reply just "done".

Substitute `{CHUNK_FILE}` = `$WD/chunkN.txt` and `{OUT_FILE}` = `$WD/chunkN.out.json` per chunk.

### 5. Apply each chunk as it completes
When a subagent finishes, apply its file:
```bash
node scripts/apply-questions.mjs "$WD/chunk1.out.json"
```
(Validates + flattens to rows + POSTs to `/api/questions/import`.) Launch the next round; repeat until
all chunks are applied.

### 6. Verify
```bash
curl -s http://localhost:3001/api/questions/pending | python3 -c "import sys,json;d=json.load(sys.stdin);print('pending now:',d['count'],'| total questions:',d['totalQuestions'])"
```
`pending` should be **0**. Spot-check a couple words:
```bash
# (optional) show a word's bank size — 30 expected per fully-enriched word
```
Report: how many words enriched, how many questions added, any words left pending.

## Rules & notes
- **Author with Claude only** — never Gemini/OpenAI/web for this content. "Claude" = the main agent
  authoring inline (small batches) OR general-purpose subagents (large batches); both are fine.
- **Prefer inline for ≤ 30 pending words.** A subagent's fixed bootstrap (system prompt + tool schemas,
  re-billed per step) is ~20k tokens regardless of batch size, so for a handful of words it's almost all
  overhead — enriching 2 words via a subagent cost ~30k tokens, mostly bootstrap. Inline reuses the
  already-loaded main context and pays only for the generated questions. Only fan out to subagents when
  the batch is large enough (> 30) that parallelism and context-hygiene outweigh the per-agent overhead.
- **≤ 15 words per chunk (hard limit, subagent path).** 15 words × 30 questions ≈ 450 items ≈ ~4 min per
  subagent — the reliable ceiling. More than that (e.g. 30 words / 900 items) hangs the subagent. Run
  rounds of ~10 concurrent subagents; apply each chunk to the DB as it finishes; then launch the next
  round.
- **Cost tip for the user:** batching is cheaper — let ~10–30 new words accumulate, then run once, rather
  than enriching one or two at a time (each tiny run still pays the fixed setup cost).
- **Judging progress:** a subagent's transcript file stays at ~128 bytes and looks *frozen even while it
  works* — that is NOT a stall signal. The real signal is the **output `.out.json` file appearing**
  (~4 min). Watch for that file, not the transcript; don't kill a subagent before ~5–6 min.
- Idempotent-ish: re-running only targets pending words, so it's safe to run whenever new words exist.
- The app writes to the **real** `.data/lexi.db` (via its API) — don't run against a copy unless testing.
- Only these three types have a bank (flashcard = the word itself; write-a-sentence = open-ended;
  type-the-word = uses the stored meaning). Don't generate for those.
