import { callStructured } from "../providers";
import { WritingScoreSchema, WRITING_SCORE_JSON_SCHEMA, type WritingPrompt } from "./types";
import { WRITING_SCORE_SYSTEM, writingScoreUser } from "./prompt";
import { loadGuidance } from "./guidance";
import { countWords, normalizeScore } from "./grade";

/*
 * Score one writing submission with the LLM. Uses the "score-writing" task on the
 * shared provider chain, injects the teacher's guidance, then normalizes bands
 * and locates correction spans (pure helpers in grade.ts).
 */
export async function scoreWriting(prompt: WritingPrompt, text: string) {
  const wordCount = countWords(text);
  const guidance = await loadGuidance(prompt.task_type);

  const raw = await callStructured("score-writing", {
    system: WRITING_SCORE_SYSTEM,
    user: writingScoreUser(prompt, prompt.task_type, text, wordCount, guidance),
    schema: WRITING_SCORE_JSON_SCHEMA,
    // Feedback JSON is large (corrections + coaching priorities); give room.
    maxTokens: 4500,
  });

  const parsed = WritingScoreSchema.parse(raw);
  return { wordCount, ...normalizeScore(parsed, text) };
}
