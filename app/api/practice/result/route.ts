import { NextResponse } from "next/server";
import { getStore } from "@/lib/store";
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
  const store = getStore();
  const word = await store.get(wordId);
  if (!word) return NextResponse.json({ error: "word not found" }, { status: 404 });

  const now = Date.now();
  const progress = applyResult(word, result, now);
  const updated = await store.update(wordId, progress);
  // best-effort attempt log for the progress page
  store
    .logAttempt({ word_id: wordId, exercise_type: exerciseType ?? "", result, ts: now })
    .catch(() => {});
  return NextResponse.json({
    word: updated,
    stage: progress.stage,
    from: word.stage,
  });
}
