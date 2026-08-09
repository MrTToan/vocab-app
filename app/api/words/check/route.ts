import { NextResponse } from "next/server";
import { getStore } from "@/lib/store";
import { currentUserId } from "@/lib/auth/user";

/**
 * GET /api/words/check?word=foo
 * -> { exists: boolean, match?: { id, word, vi_meaning } }
 * Case-insensitive, trimmed. Used by the Add page to warn about duplicates.
 */
export async function GET(req: Request) {
  const word = new URL(req.url).searchParams.get("word") ?? "";
  if (!word.trim()) return NextResponse.json({ exists: false });
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const match = await getStore().forUser(userId).findByWord(word);
  return NextResponse.json({
    exists: !!match,
    match: match
      ? { id: match.id, word: match.word, vi_meaning: match.vi_meaning }
      : undefined,
  });
}
