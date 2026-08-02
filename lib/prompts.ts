import type { ExerciseType, GeneratedExercise, Word } from "./types";

/*
 * Prompt text + JSON schemas for the three LLM jobs:
 *   1. enrichment      (Haiku)  — fill a word's fields
 *   2. exercise gen    (Haiku)  — a fresh sentence / cloze / scenario
 *   3. scoring         (Sonnet) — grade a produced answer
 * JSON schemas are hand-written (strict: additionalProperties:false + required)
 * so we don't couple to a zod->json-schema converter version.
 */

/* ───────────────────────────  Enrichment  ──────────────────────────── */

export const ENRICH_SYSTEM = `You are a bilingual English–Vietnamese vocabulary tutor for an INTERMEDIATE (B1–B2) Vietnamese learner of English.

Given an English word (and any partial info the learner already has), produce a rich, accurate study entry. Rules:
- vi_meaning: the natural Vietnamese meaning(s), concise. Vietnamese, with correct diacritics.
- definition_en: a short, learner-friendly English definition (B1–B2 vocabulary, not a dictionary copy).
- part_of_speech: e.g. "noun", "verb", "adjective". If several, list the most common, comma-separated.
- ipa: IPA transcription with slashes, e.g. "/rɪˈlʌktənt/". If unsure, best effort.
- synonyms: 3–5 common synonyms (single words or short phrases).
- collocations: 2–4 natural collocations / common partners (e.g. "make a decision", "heavy rain").
- example_simple: ONE everyday sentence that USES the word naturally, simple grammar.
- example_complex: ONE richer sentence in a more complex or formal/professional scenario that USES the word.
- false_friend_note: If the word is a common trap for Vietnamese speakers (false friend, make-vs-do type confusion, tricky preposition/collocation), give a SHORT warning. Otherwise return an empty string "".
- spelling_suggestion: If the given word looks like a MISSPELLING of a real English word, put the correctly-spelled word here; otherwise return an empty string "". Do NOT "correct" valid but uncommon words, proper nouns, technical terms, or intentional multi-word phrases.
Keep everything correct and natural. Do not invent fake IPA if the word is unusual — approximate sensibly.`;

export function enrichUser(word: string, known: Partial<Word>): string {
  const parts = [`Word: ${word}`];
  if (known.part_of_speech) parts.push(`Known part of speech: ${known.part_of_speech}`);
  if (known.vi_meaning) parts.push(`Learner's Vietnamese meaning (keep/refine): ${known.vi_meaning}`);
  if (known.example_simple) parts.push(`Existing example to keep or improve: ${known.example_simple}`);
  if (known.personal_note) parts.push(`Learner note: ${known.personal_note}`);
  if (known.tags?.length) parts.push(`Tags: ${known.tags.join(", ")}`);
  parts.push(`\nReturn the full study entry as JSON.`);
  return parts.join("\n");
}

export const ENRICH_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    part_of_speech: { type: "string" },
    ipa: { type: "string" },
    vi_meaning: { type: "string" },
    definition_en: { type: "string" },
    synonyms: { type: "array", items: { type: "string" } },
    collocations: { type: "array", items: { type: "string" } },
    example_simple: { type: "string" },
    example_complex: { type: "string" },
    false_friend_note: { type: "string" },
    spelling_suggestion: { type: "string" },
  },
  required: [
    "part_of_speech",
    "ipa",
    "vi_meaning",
    "definition_en",
    "synonyms",
    "collocations",
    "example_simple",
    "example_complex",
    "false_friend_note",
    "spelling_suggestion",
  ],
} as const;

/* ──────────────────────────  Exercise generation  ──────────────────── */

export const GEN_SYSTEM = `You generate short, FRESH vocabulary exercises for an intermediate Vietnamese learner of English. Always use the target word naturally and correctly. Vary from any example the learner has already seen. Keep sentences B1–B2 level unless a richer register is requested.`;

export function genUser(
  word: Word,
  type: Extract<ExerciseType, "cloze" | "translate" | "scenario">,
  direction?: "en_to_vn" | "vn_to_en",
): string {
  const w = word.word;
  const meaning = word.vi_meaning ? ` (Vietnamese: ${word.vi_meaning})` : "";
  switch (type) {
    case "cloze":
      return `Target word: "${w}"${meaning}.
Write ONE new, natural English sentence that uses "${w}" and where the blank is inferable from context. Then return that sentence with EVERY occurrence of the target word replaced by "____". Field: cloze_sentence.`;
    case "translate":
      if (direction === "vn_to_en") {
        return `Target word: "${w}"${meaning}.
Write ONE natural Vietnamese sentence whose best English translation clearly uses "${w}". Return only the Vietnamese sentence. Field: translate_source. The learner will translate it into English.`;
      }
      return `Target word: "${w}"${meaning}.
Write ONE natural English sentence that uses "${w}". Return only the English sentence. Field: translate_source. The learner will translate it into Vietnamese.`;
    case "scenario":
      return `Target word: "${w}"${meaning}.
Describe ONE short real-life situation WITH a required tone/register (e.g. apologising formally to a boss, reassuring a nervous friend) in which the learner must write an English sentence using "${w}" appropriately. 1–2 sentences. Field: scenario_prompt.`;
  }
}

export const CLOZE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: { cloze_sentence: { type: "string" } },
  required: ["cloze_sentence"],
} as const;

export const TRANSLATE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: { translate_source: { type: "string" } },
  required: ["translate_source"],
} as const;

export const SCENARIO_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: { scenario_prompt: { type: "string" } },
  required: ["scenario_prompt"],
} as const;

/* ───────────────────────────────  Scoring  ─────────────────────────── */

export const SCORE_SYSTEM = `You are a STRICT but fair English tutor grading a Vietnamese learner's produced English. Think step by step, then grade.

Grade three things: (1) grammar, (2) whether the TARGET WORD is used correctly and meaningfully, (3) naturalness/idiomatic quality.
Verdict rules:
- "pass": correct grammar AND the target word is used correctly and naturally.
- "partial": understandable and the target word is roughly right, but with grammar mistakes, awkward phrasing, or slightly wrong usage.
- "fail": the target word is used incorrectly/missing, OR there are major errors that break the sentence.
Do NOT be lenient — a sentence that merely contains the word but uses it wrongly is a "fail".
Always return: verdict, score (0–100), reason (one short sentence), correction (a corrected/model version, or "" if already perfect), naturalness_note (a short note on register/naturalness, or "").`;

export function scoreUser(
  word: Word,
  type: ExerciseType,
  gen: GeneratedExercise,
  answer: string,
): string {
  const w = word.word;
  const base = `Target word: "${w}"\nWord meaning (Vietnamese): ${word.vi_meaning}\nEnglish definition: ${word.definition_en}\n`;
  switch (type) {
    case "write_sentence":
      return `${base}Task: write a natural English sentence using "${w}".\nLearner's sentence: "${answer}"\nGrade it.`;
    case "translate": {
      const dir =
        gen.translate_direction === "vn_to_en"
          ? "from Vietnamese into English, and the English MUST use the target word"
          : "from English into Vietnamese";
      return `${base}Task: translate ${dir}.\nSource: "${gen.translate_source}"\nLearner's translation: "${answer}"\nGrade whether the translation is accurate and natural${gen.translate_direction === "vn_to_en" ? ` and correctly uses "${w}"` : ""}.`;
    }
    case "scenario":
      return `${base}Scenario: ${gen.scenario_prompt}\nLearner's sentence: "${answer}"\nGrade whether it uses "${w}" correctly AND fits the situation and required tone/register.`;
    default:
      return `${base}Learner's answer: "${answer}". Grade correctness and use of "${w}".`;
  }
}

export const SCORE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    verdict: { type: "string", enum: ["pass", "partial", "fail"] },
    score: { type: "number" },
    reason: { type: "string" },
    correction: { type: "string" },
    naturalness_note: { type: "string" },
  },
  required: ["verdict", "score", "reason", "correction", "naturalness_note"],
} as const;
