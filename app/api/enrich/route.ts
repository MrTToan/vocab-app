import { NextResponse } from "next/server";
import { withUser } from "@/lib/api";
import { enrichSchema } from "@/lib/api-schemas";
import { enrichWord, hasProvider } from "@/lib/llm";
import { reserveQuota, isRateLimitError } from "@/lib/auth/quota";

/** POST { word, known? } -> enrichment preview (does NOT save). Signed-in + metered. */
export const POST = withUser(enrichSchema, async ({ userId, input }) => {
  if (!hasProvider("enrich")) {
    return NextResponse.json(
      { error: "AI enrichment is not available right now." },
      { status: 400 },
    );
  }
  try {
    await reserveQuota(userId, "enrich");
    const { enrichment, spellingSuggestion } = await enrichWord(
      input.word,
      input.known ?? {},
    );
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
});
