import type { Result } from "./types";

/**
 * Local (no-LLM) answer matching for typed exercises — flashcard, cloze,
 * type-from-definition. Extracted from the practice page so it can be unit
 * tested and reused. Pure functions only.
 */

/** Normalize a typed English answer: trim, lowercase, drop trailing punctuation, collapse spaces. */
export function norm(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[.,!?;:"'’]+$/g, "")
    .replace(/\s+/g, " ");
}

/** Levenshtein edit distance between two strings. */
export function levenshtein(a: string, b: string): number {
  const m = a.length,
    n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    Array(n + 1).fill(0),
  );
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
  return dp[m][n];
}

/** A near-miss (typo): close but not exact. Tolerance scales with word length. */
export function isClose(a: string, b: string): boolean {
  if (a === b) return false;
  const tol = b.length <= 4 ? 1 : b.length <= 8 ? 2 : 3;
  return levenshtein(a, b) <= tol;
}

/** Grade a typed English answer against the target: correct | partial | incorrect. */
export function gradeEnglishWord(answer: string, target: string): Result {
  const a = norm(answer),
    t = norm(target);
  return a === t ? "correct" : isClose(a, t) ? "partial" : "incorrect";
}

/** Drop Vietnamese diacritics (and đ→d) for diacritic-insensitive matching. */
export function stripDiacritics(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d");
}

/** Normalize a Vietnamese meaning: lowercase, strip diacritics/parens/punctuation, collapse spaces. */
export function normVi(s: string): string {
  return stripDiacritics(s.toLowerCase())
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Fuzzy-match a typed Vietnamese meaning against the stored (multi-part) meaning.
 * Splits the stored meaning on separators (comma/semicolon/slash/"hoặc"/"và")
 * and accepts an exact fragment match or a substantial substring overlap.
 */
export function matchesMeaning(answer: string, viMeaning: string): boolean {
  const a = normVi(answer);
  if (a.length < 2) return false;
  const frags = viMeaning
    .split(/[,;/]|\bhoặc\b|\bvà\b/)
    .map(normVi)
    .filter(Boolean);
  return frags.some(
    (f) => f === a || (f.length >= 3 && (f.includes(a) || a.includes(f))),
  );
}
