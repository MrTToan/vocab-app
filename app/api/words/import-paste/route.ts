import { NextResponse } from "next/server";
import { getStore, normalizeWord, type NewWord } from "@/lib/store";
import { currentUserId } from "@/lib/auth/user";
import { reserveQuota, QuotaError } from "@/lib/auth/quota";
import { enrichWord, hasProvider } from "@/lib/llm";
import { clozeFromSentence, saveHarvest } from "@/lib/harvest";

/**
 * POST /api/words/import-paste  { words: string[] }
 *
 * Enrich-and-add one chunk of the paste importer. Each word goes through the
 * SAME enrichment pipeline the single-word Add uses (Vietnamese meaning,
 * examples, synonyms/collocations, spelling suggestion). The client sends the
 * new-only words (already deduped against the library in the preview step) in
 * small chunks so it can show live progress; this route re-verifies dedup for
 * safety and reports quota exhaustion so the client can stop cleanly.
 *
 * Returns per chunk:
 *   { added:   [{ word, corrected? }]   // corrected = auto-applied spelling fix
 *     skipped: string[]                 // already in library / repeated
 *     failed:  [{ word, error }]        // enrichment failed — word not added
 *     quotaExhausted: boolean           // daily cap hit; client should stop
 *     quotaMessage?: string }
 */
export async function POST(req: Request) {
  const { words } = (await req.json()) as { words?: string[] };
  if (!Array.isArray(words) || words.length === 0) {
    return NextResponse.json({ error: "words is required" }, { status: 400 });
  }

  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  if (!hasProvider("enrich")) {
    return NextResponse.json(
      { error: "Enrichment is unavailable (no API key configured)." },
      { status: 503 },
    );
  }

  const store = getStore().forUser(userId);
  const have = new Set((await store.all()).map((w) => normalizeWord(w.word)));

  const added: { word: string; corrected?: string }[] = [];
  const skipped: string[] = [];
  const failed: { word: string; error: string }[] = [];
  let quotaExhausted = false;
  let quotaMessage: string | undefined;

  for (const original of words) {
    const term = (original ?? "").trim();
    if (!term) continue;
    if (have.has(normalizeWord(term))) {
      skipped.push(term);
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
      if (fix && normalizeWord(fix) !== normalizeWord(term)) {
        if (have.has(normalizeWord(fix))) {
          // The corrected word is already in the library — nothing to add.
          skipped.push(term);
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

    // Persist (source "paste") and seed cloze questions from the examples, the
    // same way the single-word add path does.
    try {
      const created = await store.add({ ...enrichment, word, source: "paste" });
      have.add(normalizeWord(word));
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

  return NextResponse.json({ added, skipped, failed, quotaExhausted, quotaMessage });
}
