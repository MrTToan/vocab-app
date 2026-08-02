import { NextResponse } from "next/server";
import { getStore } from "@/lib/store";

/**
 * GET /api/questions/pending
 * -> words that have NO question bank yet (newly added / un-enriched).
 * Used by the /enrich-questions-bank skill to know what to generate.
 */
export async function GET() {
  const store = getStore();
  const words = await store.all();
  const have = new Set(await store.questionWordIds());
  const pending = words
    .filter((w) => !have.has(w.id))
    .map((w) => ({ id: w.id, word: w.word, vi_meaning: w.vi_meaning }));
  return NextResponse.json({
    count: pending.length,
    total: words.length,
    totalQuestions: await store.questionCount(),
    words: pending,
  });
}
