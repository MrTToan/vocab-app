import { NextResponse } from "next/server";
import { enrichWord, hasProvider } from "@/lib/llm";
import type { Word } from "@/lib/types";

/** POST { word, known? } -> enrichment preview (does NOT save). */
export async function POST(req: Request) {
  if (!hasProvider("enrich")) {
    return NextResponse.json(
      { error: "No LLM configured for enrichment. See docs/SETUP-LLM-PROVIDERS.md." },
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
    const { enrichment, spellingSuggestion } = await enrichWord(word, known ?? {});
    return NextResponse.json({ enrichment, spellingSuggestion });
  } catch (err: any) {
    return NextResponse.json(
      { error: `Enrichment failed: ${err?.message ?? err}` },
      { status: 502 },
    );
  }
}
