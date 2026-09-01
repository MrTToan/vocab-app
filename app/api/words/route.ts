import { NextResponse } from "next/server";
import { getStore, type NewWord } from "@/lib/store";
import { currentUserId } from "@/lib/auth/user";
import { reserveQuota, QuotaError } from "@/lib/auth/quota";
import { enrichWord, hasProvider } from "@/lib/llm";
import { clozeFromSentence, saveHarvest } from "@/lib/harvest";

export async function GET(req: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const store = getStore().forUser(userId);
  // ?fields=list -> slim rows for the Library list view (no heavy text columns).
  // The full word (definition/examples/notes) is fetched per-id on demand.
  if (new URL(req.url).searchParams.get("fields") === "list") {
    const words = await store.listLite();
    words.sort((a, b) => b.created_at - a.created_at);
    return NextResponse.json({ words });
  }
  const words = await store.all();
  // newest first
  words.sort((a, b) => b.created_at - a.created_at);
  return NextResponse.json({ words });
}

/**
 * POST { word, enrich?: boolean, ...knownFields }
 * Adds one word. If enrich is true and a key is set, fills fields via the LLM.
 */
export async function POST(req: Request) {
  const body = (await req.json()) as NewWord & {
    enrich?: boolean;
    allow_duplicate?: boolean;
    collectionIds?: string[];
  };
  if (!body.word || !body.word.trim()) {
    return NextResponse.json({ error: "word is required" }, { status: 400 });
  }

  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const store = getStore().forUser(userId);

  // duplicate guard — reject unless the caller explicitly allows it
  if (!body.allow_duplicate) {
    const existing = await store.findByWord(body.word);
    if (existing) {
      return NextResponse.json(
        {
          error: "duplicate",
          existing: {
            id: existing.id,
            word: existing.word,
            vi_meaning: existing.vi_meaning,
          },
        },
        { status: 409 },
      );
    }
  }

  const collectionIds = Array.isArray(body.collectionIds)
    ? body.collectionIds
    : [];
  let fields: Partial<NewWord> = { ...body };
  delete (fields as any).enrich;
  delete (fields as any).allow_duplicate;
  delete (fields as any).collectionIds;

  if (body.enrich && hasProvider("enrich")) {
    try {
      await reserveQuota(userId, "enrich");
      const { enrichment: e } = await enrichWord(body.word, body);
      fields = { ...e, ...stripEmpty(body) }; // keep any learner-supplied values
    } catch (err: any) {
      if (err instanceof QuotaError) {
        return NextResponse.json({ error: err.message }, { status: 429 });
      }
      return NextResponse.json(
        { error: `Enrichment failed: ${err?.message ?? err}` },
        { status: 502 },
      );
    }
  }

  const created = await store.add({ ...fields, word: body.word });
  if (collectionIds.length)
    await store.setWordCollections(created.id, collectionIds);
  // Seed cloze(s) from the word's example sentences so a newly-added word has a
  // few questions before the batch enrich skill ever runs.
  saveHarvest(store, [
    clozeFromSentence(created.id, created.word, created.example_simple),
    clozeFromSentence(created.id, created.word, created.example_complex),
  ]);
  return NextResponse.json({ word: created });
}

/** Keep only the non-empty learner-supplied fields so they override enrichment. */
function stripEmpty(obj: Record<string, any>): Record<string, any> {
  const keep: Record<string, any> = {};
  for (const k of [
    "part_of_speech",
    "vi_meaning",
    "example_simple",
    "personal_note",
    "tags",
  ]) {
    const v = obj[k];
    if (Array.isArray(v) ? v.length : v) keep[k] = v;
  }
  return keep;
}
