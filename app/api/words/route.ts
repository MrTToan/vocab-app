import { NextResponse } from "next/server";
import { withUser } from "@/lib/api";
import { createWordSchema, wordsQuerySchema } from "@/lib/api-schemas";
import { getStore, type NewWord } from "@/lib/store";
import { reserveQuota, QuotaError } from "@/lib/auth/quota";
import { enrichWord, hasProvider } from "@/lib/llm";
import { clozeFromSentence, saveHarvest } from "@/lib/harvest";

export const GET = withUser(wordsQuerySchema, async ({ userId, input }) => {
  const store = getStore().forUser(userId);
  // ?fields=list -> slim rows for the Library list view (no heavy text columns).
  // The full word (definition/examples/notes) is fetched per-id on demand.
  if (input.fields === "list") {
    const words = await store.listLite();
    words.sort((a, b) => b.created_at - a.created_at);
    return { words };
  }
  const words = await store.all();
  // newest first
  words.sort((a, b) => b.created_at - a.created_at);
  return { words };
});

/**
 * POST { word, enrich?: boolean, ...knownFields }
 * Adds one word. If enrich is true and a key is set, fills fields via the LLM.
 * The schema is strict: a client can never supply id/created_at/stage/owner_id.
 */
export const POST = withUser(createWordSchema, async ({ userId, input }) => {
  const store = getStore().forUser(userId);

  // duplicate guard — reject unless the caller explicitly allows it
  if (!input.allow_duplicate) {
    const existing = await store.findByWord(input.word);
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

  const collectionIds = input.collectionIds ?? [];
  const rest: Partial<typeof input> = { ...input };
  delete rest.enrich;
  delete rest.allow_duplicate;
  delete rest.collectionIds;
  let fields: Partial<NewWord> = rest;

  if (input.enrich && hasProvider("enrich")) {
    try {
      await reserveQuota(userId, "enrich");
      const { enrichment: e } = await enrichWord(input.word, rest);
      fields = { ...e, ...stripEmpty(rest) }; // keep any learner-supplied values
    } catch (err: unknown) {
      if (err instanceof QuotaError) {
        return NextResponse.json({ error: err.message }, { status: 429 });
      }
      return NextResponse.json(
        { error: `Enrichment failed: ${err instanceof Error ? err.message : String(err)}` },
        { status: 502 },
      );
    }
  }

  const created = await store.add({ ...fields, word: input.word });
  if (collectionIds.length)
    await store.setWordCollections(created.id, collectionIds);
  // Seed cloze(s) from the word's example sentences so a newly-added word has a
  // few questions before the batch enrich skill ever runs.
  saveHarvest(store, [
    clozeFromSentence(created.id, created.word, created.example_simple),
    clozeFromSentence(created.id, created.word, created.example_complex),
  ]);
  return NextResponse.json({ word: created });
});

/** Keep only the non-empty learner-supplied fields so they override enrichment. */
function stripEmpty(obj: Record<string, unknown>): Record<string, unknown> {
  const keep: Record<string, unknown> = {};
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
