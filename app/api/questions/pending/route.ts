import { NextResponse } from "next/server";
import { getStore } from "@/lib/store";
import { currentUserId } from "@/lib/auth/user";

/**
 * GET /api/questions/pending
 * -> words that have NO question bank yet (newly added / un-enriched).
 * Used by the /enrich-questions-bank skill to know what to generate.
 */
export async function GET() {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const store = getStore().forUser(userId);
  // Slim rows only — the response needs id/word/vi_meaning, never the heavy
  // content columns that `all()` would load.
  const words = await store.listLite();
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
