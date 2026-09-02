import { NextResponse } from "next/server";
import { withUser } from "@/lib/api";
import { practiceResultSchema } from "@/lib/api-schemas";
import { getStore } from "@/lib/store";
import { applyResult } from "@/lib/engine";

/**
 * POST { wordId, result } -> records the attempt and advances/demotes the
 * word's stage. The single source of truth for progress mutation.
 */
export const POST = withUser(practiceResultSchema, async ({ userId, input }) => {
  const { wordId, result, exerciseType } = input;
  const store = getStore().forUser(userId);
  const word = await store.get(wordId);
  if (!word) return NextResponse.json({ error: "word not found" }, { status: 404 });

  const now = Date.now();
  const progress = applyResult(word, result, now);
  // Persist progress into this user's user_words (studying) AND log the attempt
  // atomically — one write batch, so the progress page can never miss an attempt
  // a stage change was based on.
  const updated = await store.recordResult(wordId, progress, {
    word_id: wordId,
    exercise_type: exerciseType ?? "",
    result,
    ts: now,
  });
  return NextResponse.json({
    word: updated,
    stage: progress.stage,
    from: word.stage,
  });
});
