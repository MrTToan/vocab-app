/** Escape a string for literal use inside a RegExp. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Turn an English sentence into a cloze by blanking every whole-word occurrence
 * of `word` (case-insensitive). Returns `{ payload, answer }`, or `null` when the
 * word doesn't appear as a whole word — so callers can skip sentences they can't
 * make a clean cloze from (e.g. only an inflected form is present).
 */
export function toCloze(
  sentence: string,
  word: string,
): { payload: string; answer: string } | null {
  const s = (sentence ?? "").trim();
  const w = (word ?? "").trim();
  if (!s || !w) return null;
  const pattern = `\\b${escapeRegExp(w)}\\b`;
  if (!new RegExp(pattern, "i").test(s)) return null;
  const payload = s.replace(new RegExp(pattern, "gi"), "____");
  return { payload, answer: w };
}
