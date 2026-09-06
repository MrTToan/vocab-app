/*
 * The OpenAI fallback's "say it" verdict + an APPROXIMATE closeness score — a
 * WORD-MATCH check, not clinical phoneme scoring.
 *
 * Whisper gives us a transcription of what the learner said; we can only ask
 * "how close is that to the target word?" We normalize both sides (lowercase,
 * strip punctuation, drop diacritics) and compute a 0–100 closeness score by
 * blending a normalized edit-distance ratio with a light phonetic-key ratio, so
 * "pollination" vs "pollinations" scores high and an unrelated word scores low.
 * An exact hit (or the target appearing as a whole token in a short phrase)
 * scores 100. The verdict is derived from that score against the pass threshold,
 * so a high score is never labelled "needs-work" and vice-versa.
 *
 * This is honest about its limits: it's an APPROXIMATE relative closeness score,
 * NOT per-phoneme accuracy (that only comes from Azure). Pure + unit-tested
 * (tests/speech-match.test.ts).
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
 * A crude phonetic key: fold common English spelling→sound quirks, keep the
 * leading letter, drop later vowels, and collapse runs. Two words that SOUND
 * alike land on the same (or a near) key even when spelled differently. This is
 * a lightweight metaphone-ish normalization, not a full phonetic algorithm.
 */
export function phoneticKey(s: string): string {
  let t = normalize(s).replace(/[^a-z]/g, "");
  if (!t) return "";
  t = t
    .replace(/ph/g, "f")
    .replace(/ck/g, "k")
    .replace(/sch/g, "sk")
    .replace(/q/g, "k")
    .replace(/x/g, "ks")
    .replace(/wr/g, "r")
    .replace(/kn/g, "n")
    .replace(/gh/g, "")
    .replace(/c/g, "k"); // approximate hard/soft c as k
  const first = t[0];
  const rest = t.slice(1).replace(/[aeiou]/g, ""); // vowels carry little identity after the first sound
  return (first + rest).replace(/(.)\1+/g, "$1"); // collapse doubled letters
}

/** 0..1 closeness of two strings by normalized (uncapped) edit distance. */
function levRatio(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  const d = editDistance(a, b, maxLen); // full distance (no early cap)
  return 1 - d / maxLen;
}

/** 0..100 closeness of two single strings: blend spelling + phonetic ratios. */
function pairScore(a: string, b: string): number {
  const spelling = levRatio(a, b);
  const phonetic = levRatio(phoneticKey(a), phoneticKey(b));
  return Math.max(0, 100 * (0.6 * spelling + 0.4 * phonetic));
}

/**
 * Approximate 0..100 closeness of the transcript to the reference word. An exact
 * hit — or the target as a whole token in a short phrase — is 100; otherwise we
 * take the best score across the whole heard phrase and each of its tokens, so a
 * target buried in a phrase still scores on its own merits.
 */
export function similarityScore(transcript: string, reference: string): number {
  const ref = normalize(reference);
  const heard = normalize(transcript);
  if (!ref || !heard) return 0;
  if (heard === ref) return 100;
  const tokens = heard.split(" ").filter(Boolean);
  if (tokens.includes(ref)) return 100;
  const best = [heard, ...tokens].reduce((m, c) => Math.max(m, pairScore(c, ref)), 0);
  return Math.round(best);
}

/**
 * Did the transcript say the reference word, and how close was it? Returns the
 * verdict, whether it was an exact hit (for the feedback wording), and an
 * approximate 0..100 closeness `score`. The verdict is derived from the score
 * against `threshold` (the product pass score, default 70) so the number and the
 * label always agree.
 */
export function wordMatch(
  transcript: string,
  reference: string,
  threshold = 70,
): { verdict: "good" | "needs-work"; exact: boolean; score: number } {
  const ref = normalize(reference);
  const heard = normalize(transcript);
  const exact = !!ref && (heard === ref || heard.split(" ").filter(Boolean).includes(ref));
  const score = similarityScore(transcript, reference);
  return { verdict: score >= threshold ? "good" : "needs-work", exact, score };
}

/* ───────────────────────────  sentence matching  ─────────────────────── */

/*
 * The OpenAI-fallback matcher for a WHOLE SENTENCE ("say sentence"). A single
 * word's `wordMatch` is wrong here — any one matching token would score 100. A
 * sentence needs BOTH: did it sound like the sentence (overall closeness) AND
 * did they actually say (most of) its words. We blend:
 *   - a normalized whole-string edit-distance ratio (order-sensitive closeness), with
 *   - a COMPLETENESS signal: the fraction of the reference's words actually present,
 *     matched order-tolerantly (each reference word greedily paired with its closest
 *     unused transcript token, counting a near-miss like a plural).
 * Still an APPROXIMATE closeness score, NOT per-phoneme accuracy — labelled the
 * same honest "word-match"/"approx." way the single-word path is.
 */

/** A reference token is "covered" if some transcript token is this close (0..1). */
const TOKEN_MATCH_RATIO = 0.8;

/** 0..1 closeness of two tokens, blending spelling + phonetic (as pairScore/100). */
function tokenCloseness(a: string, b: string): number {
  return pairScore(a, b) / 100;
}

/**
 * Fraction (0..1) of the reference's words that appear in the transcript,
 * order-tolerant: each reference token is greedily matched to its closest
 * still-unused transcript token, and counts as covered when that closeness clears
 * TOKEN_MATCH_RATIO (so "pollinations" covers "pollination"). Repeated reference
 * words each need their own transcript token.
 */
export function sentenceCompleteness(transcript: string, reference: string): number {
  const refTokens = normalize(reference).split(" ").filter(Boolean);
  const heardTokens = normalize(transcript).split(" ").filter(Boolean);
  if (refTokens.length === 0) return 0;
  const used = new Array(heardTokens.length).fill(false);
  let covered = 0;
  for (const r of refTokens) {
    let bestIdx = -1;
    let bestScore = 0;
    for (let i = 0; i < heardTokens.length; i++) {
      if (used[i]) continue;
      const c = heardTokens[i] === r ? 1 : tokenCloseness(heardTokens[i], r);
      if (c > bestScore) {
        bestScore = c;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0 && bestScore >= TOKEN_MATCH_RATIO) {
      used[bestIdx] = true;
      covered++;
    }
  }
  return covered / refTokens.length;
}

/**
 * Approximate 0..100 closeness of a spoken SENTENCE to the reference sentence,
 * plus the completeness component (0..100) so the UI can surface how much of the
 * sentence was actually said. Blends whole-string similarity with completeness.
 */
export function sentenceSimilarity(
  transcript: string,
  reference: string,
): { score: number; completeness: number } {
  const ref = normalize(reference);
  const heard = normalize(transcript);
  if (!ref) return { score: 0, completeness: 0 };
  if (!heard) return { score: 0, completeness: 0 };
  const completeness = sentenceCompleteness(transcript, reference);
  const similarity = heard === ref ? 1 : levRatio(heard, ref);
  const blended = 0.5 * similarity + 0.5 * completeness;
  return { score: Math.round(100 * Math.max(0, Math.min(1, blended))), completeness: Math.round(100 * completeness) };
}

/**
 * The sentence-level verdict + approximate score for the OpenAI fallback path.
 * Verdict is derived from the blended score against `threshold` so the number and
 * label always agree; `completeness` is surfaced for the learner's feedback.
 */
export function sentenceMatch(
  transcript: string,
  reference: string,
  threshold = 70,
): { verdict: "good" | "needs-work"; score: number; completeness: number } {
  const { score, completeness } = sentenceSimilarity(transcript, reference);
  return { verdict: score >= threshold ? "good" : "needs-work", score, completeness };
}
