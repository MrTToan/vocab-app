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

/**
 * Fill a cloze sentence's blank(s) back in with `answer`, reconstructing the
 * completed fill-in-blank sentence the learner just worked on — the natural thing
 * to read aloud for "say sentence" scoring. Returns null when there's nothing
 * clean to build (no sentence, no answer, or no blank present), so callers can
 * skip offering the control rather than score a broken reference.
 */
export function fillCloze(clozeSentence: string, answer: string): string | null {
  const s = (clozeSentence ?? "").trim();
  const a = (answer ?? "").trim();
  if (!s || !a || !/_{2,}/.test(s)) return null;
  return s.replace(/_{2,}/g, a);
}
