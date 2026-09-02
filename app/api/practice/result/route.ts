import { NextResponse } from "next/server";
import { getStore } from "@/lib/store";
import { currentUserId } from "@/lib/auth/user";
import { applyResult } from "@/lib/engine";
import type { Result } from "@/lib/types";

/**
 * POST { wordId, result } -> records the attempt and advances/demotes the
 * word's stage. The single source of truth for progress mutation.
 */
export async function POST(req: Request) {
  const { wordId, result, exerciseType } = (await req.json()) as {
    wordId: string;
    result: Result;
    exerciseType?: string;
  };
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
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
}
