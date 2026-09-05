/*
 * The OpenAI fallback's "say it" verdict — a WORD-MATCH check, not phoneme
 * scoring.
 *
 * Whisper gives us a transcription of what the learner said; we can only ask
 * "did they say the target word?" We normalize both sides (lowercase, strip
 * punctuation, drop diacritics) and accept an exact hit, the reference appearing
 * as a whole token in a short phrase, or a 1-edit near-miss (Whisper mis-hearing
 * one letter). This is honest about its limits: there is NO accuracy number
 * behind a word-match verdict. Pure + unit-tested (tests/speech-match.test.ts).
 */

/** lowercase, strip accents & punctuation, collapse whitespace. */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // combining accents
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Levenshtein distance, capped early once it exceeds `max`. */
export function editDistance(a: string, b: string, max = 2): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1; // whole row already past the cap
    prev = cur;
  }
  return prev[b.length];
}

/**
 * Did the transcript say the reference word? Returns a verdict plus whether it
 * was an exact hit (for the feedback wording). Tolerance scales with word
 * length so short words aren't matched by a 1-edit fluke.
 */
export function wordMatch(
  transcript: string,
  reference: string,
): { verdict: "good" | "needs-work"; exact: boolean } {
  const ref = normalize(reference);
  const heard = normalize(transcript);
  if (!ref) return { verdict: "needs-work", exact: false };
  if (heard === ref) return { verdict: "good", exact: true };

  const tokens = heard.split(" ").filter(Boolean);
  if (tokens.includes(ref)) return { verdict: "good", exact: true };

  // A near-miss on the whole phrase or any single token (multi-word targets).
  const tol = ref.length <= 4 ? 1 : 2;
  const near =
    editDistance(heard, ref, tol) <= tol ||
    tokens.some((t) => editDistance(t, ref, tol) <= tol);
  return { verdict: near ? "good" : "needs-work", exact: false };
}
