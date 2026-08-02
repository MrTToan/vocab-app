import {
  EnrichmentSchema,
  ScoreSchema,
  GeneratedExerciseSchema,
  type Enrichment,
  type Score,
  type GeneratedExercise,
  type ExerciseType,
  type Word,
} from "./types";
import {
  ENRICH_SYSTEM,
  ENRICH_SCHEMA,
  enrichUser,
  GEN_SYSTEM,
  genUser,
  CLOZE_SCHEMA,
  TRANSLATE_SCHEMA,
  SCENARIO_SCHEMA,
  SCORE_SYSTEM,
  SCORE_SCHEMA,
  scoreUser,
} from "./prompts";
import { callStructured, hasProvider, hasAnyLLM } from "./providers";
import { cleanSpellingSuggestion } from "./spell";

// Re-export provider helpers so routes can gate on per-task availability.
export { hasProvider, hasAnyLLM };
/** Any LLM configured at all (used for coarse UI banners). */
export function hasLLM(): boolean {
  return hasAnyLLM();
}

export async function enrichWord(
  word: string,
  known: Partial<Word> = {},
): Promise<{ enrichment: Enrichment; spellingSuggestion: string }> {
  const raw = (await callStructured("enrich", {
    system: ENRICH_SYSTEM,
    user: enrichUser(word, known),
    schema: ENRICH_SCHEMA,
    // headroom for "thinking" models (Gemini/Claude), whose reasoning tokens
    // count against max_tokens — too low and the JSON output gets starved.
    maxTokens: 2500,
  })) as Record<string, unknown>;
  // EnrichmentSchema.parse strips the non-stored spelling_suggestion key.
  return {
    enrichment: EnrichmentSchema.parse(raw),
    spellingSuggestion: cleanSpellingSuggestion(word, raw.spelling_suggestion),
  };
}

export async function generateExercise(
  word: Word,
  type: Extract<ExerciseType, "cloze" | "translate" | "scenario">,
  direction?: "en_to_vn" | "vn_to_en",
): Promise<GeneratedExercise> {
  const schema =
    type === "cloze"
      ? CLOZE_SCHEMA
      : type === "translate"
        ? TRANSLATE_SCHEMA
        : SCENARIO_SCHEMA;
  const raw = (await callStructured("generate", {
    system: GEN_SYSTEM,
    user: genUser(word, type, direction),
    schema,
    maxTokens: 1500,
  })) as Record<string, unknown>;
  if (type === "translate" && direction) raw.translate_direction = direction;
  return GeneratedExerciseSchema.parse(raw);
}

export async function scoreAnswer(
  word: Word,
  type: ExerciseType,
  gen: GeneratedExercise,
  answer: string,
): Promise<Score> {
  const raw = await callStructured("score", {
    system: SCORE_SYSTEM,
    user: scoreUser(word, type, gen, answer),
    schema: SCORE_SCHEMA,
    maxTokens: 2000,
  });
  return ScoreSchema.parse(raw);
}
