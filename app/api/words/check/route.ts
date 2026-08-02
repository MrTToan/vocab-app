import { NextResponse } from "next/server";
import { getStore } from "@/lib/store";

/**
 * GET /api/words/check?word=foo
 * -> { exists: boolean, match?: { id, word, vi_meaning } }
 * Case-insensitive, trimmed. Used by the Add page to warn about duplicates.
 */
export async function GET(req: Request) {
  const word = new URL(req.url).searchParams.get("word") ?? "";
  if (!word.trim()) return NextResponse.json({ exists: false });
  const match = await getStore().findByWord(word);
  return NextResponse.json({
    exists: !!match,
    match: match
      ? { id: match.id, word: match.word, vi_meaning: match.vi_meaning }
      : undefined,
  });
}
