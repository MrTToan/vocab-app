import { NextResponse } from "next/server";
import { enrichWord, hasProvider } from "@/lib/llm";
import { currentUserId } from "@/lib/auth/user";
import { reserveQuota, isRateLimitError } from "@/lib/auth/quota";
import type { Word } from "@/lib/types";

/** POST { word, known? } -> enrichment preview (does NOT save). Signed-in + metered. */
export async function POST(req: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!hasProvider("enrich")) {
    return NextResponse.json(
      { error: "AI enrichment is not available right now." },
      { status: 400 },
    );
  }
  const { word, known } = (await req.json()) as {
    word: string;
    known?: Partial<Word>;
  };
  if (!word?.trim()) {
    return NextResponse.json({ error: "word is required" }, { status: 400 });
  }
  try {
    await reserveQuota(userId, "enrich");
    const { enrichment, spellingSuggestion } = await enrichWord(word, known ?? {});
    return NextResponse.json({ enrichment, spellingSuggestion });
  } catch (err: unknown) {
    if (isRateLimitError(err)) {
      return NextResponse.json({ error: err.message }, { status: 429 });
    }
    return NextResponse.json(
      { error: `Enrichment failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 },
    );
  }
}
