import { NextResponse } from "next/server";
import { withUser } from "@/lib/api";
import { checkWordQuerySchema } from "@/lib/api-schemas";
import { getStore } from "@/lib/store";

/**
 * GET /api/words/check?word=foo
 * -> { exists: boolean, match?: { id, word, vi_meaning } }
 * Case-insensitive, trimmed. Used by the Add page to warn about duplicates.
 */
export const GET = withUser(checkWordQuerySchema, async ({ userId, input }) => {
  const word = input.word ?? "";
  if (!word.trim()) return NextResponse.json({ exists: false });
  const match = await getStore().forUser(userId).findByWord(word);
  return NextResponse.json({
    exists: !!match,
    match: match
      ? { id: match.id, word: match.word, vi_meaning: match.vi_meaning }
      : undefined,
  });
});
