import { NextResponse } from "next/server";
import { withUser } from "@/lib/api";
import { importPasteSchema } from "@/lib/api-schemas";
import { getStore, type NewWord } from "@/lib/store";
import { reserveQuota, QuotaError } from "@/lib/auth/quota";
import { enrichWord, hasProvider } from "@/lib/llm";
import { clozeFromSentence, saveHarvest } from "@/lib/harvest";
import { lemma } from "@/lib/lemma";

/**
 * POST /api/words/import-paste  { words: string[], collectionId?: string }
 *
 * Enrich-and-add one chunk of the paste importer, with LEMMA-based dedup and
 * optional collection tagging. Each word goes through the SAME enrichment
 * pipeline the single-word Add uses. The client sends the new-only words
 * (already planned via /import-plan) in small chunks for live progress; this
 * route re-verifies dedup by lemma for safety, so a word that already exists
 * (as any inflection — "running" when "run" is studied) is TAGGED into the
 * collection instead of duplicated, and only genuinely-new words are created.
 *
 * When `collectionId` is given (a collection the caller can edit — a new word's
 * list or one they own), every word this chunk touches (new or existing) is
 * tagged into it, so the collection ends up complete. A collection the caller
 * cannot edit → 403 before any quota is spent.
 *
 * Returns per chunk:
 *   { added:   [{ word, corrected? }]      // corrected = auto-applied spelling fix
 *     tagged:  [{ word, matched }]         // existing word linked into the collection
 *     skipped: string[]                    // repeated within the chunk / no collection
 *     failed:  [{ word, error }]           // enrichment failed — word not added
 *     quotaExhausted: boolean              // daily cap hit; client should stop
 *     quotaMessage?: string }
 */
export const POST = withUser(importPasteSchema, async ({ userId, input }) => {
  if (!hasProvider("enrich")) {
    return NextResponse.json(
      { error: "Enrichment is unavailable (no API key configured)." },
      { status: 503 },
    );
  }

  const store = getStore().forUser(userId);
  const collectionId = input.collectionId;

  // Fail fast if a collection was named the caller can't edit — before any LLM
  // quota is spent. An empty membership change runs the owner/editable gate
  // (throws ForbiddenError → 403 via the wrapper) without writing anything.
  if (collectionId) await store.setCollectionMembers(collectionId, {});

  // Existing studied words keyed by lemma → ref, so an inflected paste maps back
  // to the word's id to tag (rather than duplicate). Rebuilt per request, so it
  // already reflects words added by earlier chunks of the same run.
  const refs = await store.studiedRefs();
  const existingByLemma = new Map<string, { id: string; word: string }>();
  for (const r of refs) {
    const key = lemma(r.word);
    if (key && !existingByLemma.has(key)) existingByLemma.set(key, r);
  }

  const added: { word: string; corrected?: string }[] = [];
  const tagged: { word: string; matched: string }[] = [];
  const skipped: string[] = [];
  const failed: { word: string; error: string }[] = [];
  let quotaExhausted = false;
  let quotaMessage: string | undefined;

  // Tag an existing word into the collection (owner already verified above) and
  // record it. Safe no-op when no collection was chosen.
  async function tagExisting(surface: string, ref: { id: string; word: string }) {
    if (collectionId) await store.setCollectionMembers(collectionId, { add: [ref.id] });
    tagged.push({ word: surface, matched: ref.word });
  }

  for (const original of input.words) {
    const term = (original ?? "").trim();
    if (!term) continue;

    // Already have this lemma → tag the existing word, never duplicate.
    const existing = existingByLemma.get(lemma(term));
    if (existing) {
      await tagExisting(term, existing);
      continue;
    }

    // Enrich (respecting the per-user daily quota). One quota unit per word.
    let word = term;
    let enrichment: NewWord;
    try {
      await reserveQuota(userId, "enrich");
      const first = await enrichWord(term);

      // Apply a spelling correction if the model flagged one: rename to the
      // corrected spelling and re-enrich it clean so the stored content matches
      // the intended word (misspellings are rare, so the extra call is cheap).
      const fix = first.spellingSuggestion;
      if (fix && lemma(fix) !== lemma(term)) {
        // The corrected spelling needs its own lemma dedup check.
        const fixExisting = existingByLemma.get(lemma(fix));
        if (fixExisting) {
          await tagExisting(term, fixExisting);
          continue;
        }
        try {
          await reserveQuota(userId, "enrich");
          const second = await enrichWord(fix);
          word = fix;
          enrichment = { ...second.enrichment, word: fix };
        } catch (err) {
          if (err instanceof QuotaError) {
            // Out of quota for the re-enrich: keep the first-pass content under
            // the corrected spelling rather than losing the word entirely.
            word = fix;
            enrichment = { ...first.enrichment, word: fix };
          } else throw err;
        }
      } else {
        enrichment = { ...first.enrichment, word: term };
      }
    } catch (err: unknown) {
      if (err instanceof QuotaError) {
        quotaExhausted = true;
        quotaMessage = err.message;
        break; // stop cleanly; report what was added so far
      }
      const msg = err instanceof Error ? err.message : String(err);
      failed.push({ word: term, error: msg });
      continue;
    }

    // Persist (source "paste"), tag into the collection, and seed cloze
    // questions from the examples, like the single-word add path does.
    try {
      const created = await store.add({ ...enrichment, word, source: "paste" });
      // Record this word so a later same-chunk repeat tags rather than dupes.
      existingByLemma.set(lemma(created.word), { id: created.id, word: created.word });
      if (collectionId)
        await store.setCollectionMembers(collectionId, { add: [created.id] });
      saveHarvest(store, [
        clozeFromSentence(created.id, created.word, created.example_simple),
        clozeFromSentence(created.id, created.word, created.example_complex),
      ]);
      added.push(word === term ? { word } : { word, corrected: term });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      failed.push({ word: term, error: msg });
    }
  }

  return NextResponse.json({
    added,
    tagged,
    skipped,
    failed,
    quotaExhausted,
    quotaMessage,
  });
});
