import { NextResponse } from "next/server";
import { getStore, normalizeWord } from "@/lib/store";
import { currentUserId } from "@/lib/auth/user";

/**
 * POST /api/words/check-bulk  { words: string[] }
 * -> { existing: string[] }  (the subset already in the user's library)
 *
 * The cheap, no-LLM cost-control gate for the paste importer: the client shows
 * "N new · M already in your list" before spending any enrichment quota.
 * Case-insensitive, trimmed. Returns the words (as sent) that already exist.
 */
export async function POST(req: Request) {
  const { words } = (await req.json()) as { words?: string[] };
  if (!Array.isArray(words)) {
    return NextResponse.json({ error: "words is required" }, { status: 400 });
  }

  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const store = getStore().forUser(userId);
  // One indexed IN(...) query over the pasted words — never loads the library.
  const have = await store.existingWords(words);

  const existing = words.filter((w) => w?.trim() && have.has(normalizeWord(w)));
  return NextResponse.json({ existing });
}
