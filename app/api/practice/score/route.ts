import { NextResponse } from "next/server";
import { getStore } from "@/lib/store";
import { currentUserId } from "@/lib/auth/user";
import { reserveQuota, QuotaError } from "@/lib/auth/quota";
import { scoreAnswer, hasProvider } from "@/lib/llm";
import { clozeFromSentence, saveHarvest } from "@/lib/harvest";
import type { ExerciseType, GeneratedExercise } from "@/lib/types";

/**
 * POST { wordId, exerciseType, generated, answer } -> a Score.
 * Grading only — it does NOT change progress. The client calls
 * /api/practice/result afterward with the mapped result.
 */
export async function POST(req: Request) {
  if (!hasProvider("score")) {
    return NextResponse.json(
      { error: "AI scoring is not available right now." },
      { status: 400 },
    );
  }
  const { wordId, exerciseType, generated, answer } = (await req.json()) as {
    wordId: string;
    exerciseType: ExerciseType;
    generated: GeneratedExercise;
    answer: string;
  };
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
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
  } catch (err: any) {
    if (err instanceof QuotaError) {
      return NextResponse.json({ error: err.message }, { status: 429 });
    }
    return NextResponse.json(
      { error: `Scoring failed: ${err?.message ?? err}` },
      { status: 502 },
    );
  }
}
