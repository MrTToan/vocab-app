import { NextResponse } from "next/server";
import { withUser } from "@/lib/api";
import { practiceScoreSchema } from "@/lib/api-schemas";
import { getStore } from "@/lib/store";
import { reserveQuota, isRateLimitError } from "@/lib/auth/quota";
import { scoreAnswer, hasProvider } from "@/lib/llm";
import { clozeFromSentence, saveHarvest } from "@/lib/harvest";

/**
 * POST { wordId, exerciseType, generated, answer } -> a Score.
 * Grading only — it does NOT change progress. The client calls
 * /api/practice/result afterward with the mapped result.
 */
export const POST = withUser(practiceScoreSchema, async ({ userId, input }) => {
  if (!hasProvider("score")) {
    return NextResponse.json(
      { error: "AI scoring is not available right now." },
      { status: 400 },
    );
  }
  const { wordId, exerciseType, generated, answer } = input;
  const store = getStore().forUser(userId);
  const word = await store.get(wordId);
  if (!word) return NextResponse.json({ error: "word not found" }, { status: 404 });

  try {
    await reserveQuota(userId, "score");
    const gen = generated ?? {};
    const score = await scoreAnswer(word, exerciseType, gen, answer ?? "");

    // Harvest the model's better English sentence into a cloze (self-refilling
    // bank). The correction is the model's own good sentence, so its quality
    // doesn't depend on the learner's verdict — a non-empty correction that
    // contains the word (clozeFromSentence guards that) is worth keeping.
    // Only English-producing exercises yield a cloze-able correction.
    const correction = (score.correction ?? "").trim();
    const englishCorrection =
      exerciseType === "write_sentence" ||
      exerciseType === "scenario" ||
      (exerciseType === "translate" && gen.translate_direction === "vn_to_en");
    if (correction && englishCorrection) {
      saveHarvest(store, [clozeFromSentence(word.id, word.word, correction)]);
    }

    return NextResponse.json({ score });
  } catch (err: unknown) {
    if (isRateLimitError(err)) {
      return NextResponse.json({ error: err.message }, { status: 429 });
    }
    return NextResponse.json(
      { error: `Scoring failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 },
    );
  }
});
