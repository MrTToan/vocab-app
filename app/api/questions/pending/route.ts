import { withUser } from "@/lib/api";
import { emptySchema } from "@/lib/api-schemas";
import { getStore } from "@/lib/store";

/**
 * GET /api/questions/pending
 * -> words that have NO question bank yet (newly added / un-enriched).
 * Used by the /enrich-questions-bank skill to know what to generate.
 */
export const GET = withUser(emptySchema, async ({ userId }) => {
  const store = getStore().forUser(userId);
  // Slim rows only — the response needs id/word/vi_meaning, never the heavy
  // content columns that `all()` would load.
  const words = await store.listLite();
  const have = new Set(await store.questionWordIds());
  const pending = words
    .filter((w) => !have.has(w.id))
    .map((w) => ({ id: w.id, word: w.word, vi_meaning: w.vi_meaning }));
  return {
    count: pending.length,
    total: words.length,
    totalQuestions: await store.questionCount(),
    words: pending,
  };
});
