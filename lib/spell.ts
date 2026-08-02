/**
 * Sanitize the LLM's spelling suggestion for a newly-entered word.
 *
 * Returns "" (meaning "no suggestion, the word is fine") when the raw value is
 * empty, matches the input word ignoring case/surrounding space, or the input is
 * a multi-word phrase — so we never second-guess intentional phrases or valid
 * words. Otherwise returns the trimmed suggestion.
 */
export function cleanSpellingSuggestion(word: string, raw: unknown): string {
  if (typeof raw !== "string") return "";
  const suggestion = raw.trim();
  if (!suggestion) return "";
  const w = word.trim();
  if (w.includes(" ")) return ""; // a phrase — don't "correct" it
  if (suggestion.toLowerCase() === w.toLowerCase()) return "";
  return suggestion;
}
