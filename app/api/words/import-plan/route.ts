import { withUser } from "@/lib/api";
import { importPlanSchema } from "@/lib/api-schemas";
import { getStore } from "@/lib/store";
import { lemma, dedupeByLemma } from "@/lib/lemma";
import { MAX_PASTE_WORDS } from "@/lib/paste";

/**
 * POST /api/words/import-plan  { words: string[] }
 * -> { newWords, taggedExisting: [{ word, matched, id }], duplicatesInPaste, capped }
 *
 * The cheap, no-LLM planning step for the paste importer. It dedupes the pasted
 * list by LEMMA (base form) both within itself and against the user's existing
 * words, so the UI can show — before any quota is spent — exactly what will
 * happen: which words are brand-new (to enrich + add), which already exist (to
 * TAG into the chosen collection rather than duplicate), and how many pasted
 * repeats were merged away. Read-only: no words or memberships are written here
 * (tagging happens on confirm via /members and enrich via /import-paste).
 *
 * "running" ≡ "run": if the user already studies "run", pasting "running" is
 * reported under taggedExisting (matched: "run"), never as a new word.
 */
export const POST = withUser(importPlanSchema, async ({ userId, input }) => {
  const store = getStore().forUser(userId);

  // The user's studied words, keyed by lemma → existing ref. First-seen wins if
  // two existing words share a lemma (rare; both are already the user's own).
  const refs = await store.studiedRefs();
  const existingByLemma = new Map<string, { id: string; word: string }>();
  for (const r of refs) {
    const key = lemma(r.word);
    if (key && !existingByLemma.has(key)) existingByLemma.set(key, r);
  }

  // Collapse repeats within the paste by lemma (keeps first-seen surface form).
  const { unique, duplicateCount } = dedupeByLemma(input.words);

  const newWords: string[] = [];
  const taggedExisting: { word: string; matched: string; id: string }[] = [];
  for (const surface of unique) {
    const match = existingByLemma.get(lemma(surface));
    if (match) taggedExisting.push({ word: surface, matched: match.word, id: match.id });
    else newWords.push(surface);
  }

  return {
    newWords,
    taggedExisting,
    duplicatesInPaste: duplicateCount,
    capped: newWords.length > MAX_PASTE_WORDS,
  };
});
