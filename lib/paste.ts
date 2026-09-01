/**
 * Pure parsing for the paste-a-word-list importer.
 *
 * The user pastes a list of English words/phrases separated by newlines and/or
 * commas. We split robustly, trim, drop blanks, and drop case-insensitive
 * duplicates within the paste (keeping the first occurrence's original casing).
 * No network, no LLM — this is the cheap client-side gate that runs before any
 * duplicate check or enrichment.
 */

/**
 * Generous default cap on how many words one paste can enrich in a single run.
 * Enriching N words is N LLM calls against the per-user daily quota, so a very
 * large paste is capped to protect cost/quota. Configurable via the
 * NEXT_PUBLIC_MAX_PASTE_WORDS env var. See PR notes.
 */
export const MAX_PASTE_WORDS: number = (() => {
  const env = Number(process.env.NEXT_PUBLIC_MAX_PASTE_WORDS);
  return Number.isFinite(env) && env > 0 ? env : 200;
})();

export interface ParsedPaste {
  /** Unique words, in first-seen order, original casing preserved. */
  words: string[];
  /** How many entries were dropped as case-insensitive repeats within the paste. */
  duplicatesInPaste: number;
}

/**
 * Split a pasted blob into a clean, de-duplicated list of words/phrases.
 * Splits on newlines and commas; trims whitespace; drops blank entries; drops
 * case-insensitive duplicates within the paste.
 */
export function parsePasteList(text: string): ParsedPaste {
  const raw = (text ?? "")
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const words: string[] = [];
  const seen = new Set<string>();
  let duplicatesInPaste = 0;
  for (const w of raw) {
    const key = w.toLowerCase();
    if (seen.has(key)) {
      duplicatesInPaste++;
      continue;
    }
    seen.add(key);
    words.push(w);
  }
  return { words, duplicatesInPaste };
}
