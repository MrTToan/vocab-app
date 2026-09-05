import { describe, it, expect } from "vitest";
import { normalize, editDistance, wordMatch, similarityScore, phoneticKey } from "@/lib/speech/match";

/*
 * The OpenAI-fallback "say it" verdict is a WORD-MATCH check on the Whisper
 * transcript (an approximate closeness score, not phoneme scoring). These pin the
 * normalization + closeness score so a mis-heard letter scores high and passes,
 * but a genuinely wrong word scores low and fails.
 */

describe("normalize", () => {
  it("lowercases, strips accents and punctuation, collapses space", () => {
    expect(normalize("  Café!! ")).toBe("cafe");
    expect(normalize("Don't-stop")).toBe("don t stop");
  });
});

describe("editDistance", () => {
  it("counts single edits and caps early", () => {
    expect(editDistance("cat", "cat")).toBe(0);
    expect(editDistance("cat", "car")).toBe(1);
    expect(editDistance("cat", "elephant", 2)).toBe(3); // past the cap → max+1
  });
});

describe("phoneticKey", () => {
  it("folds spelling quirks so like-sounding words share a key", () => {
    expect(phoneticKey("phone")).toBe(phoneticKey("fone"));
    // Trailing plural adds one letter to an otherwise identical key.
    expect(phoneticKey("pollinations").startsWith(phoneticKey("pollination"))).toBe(true);
  });
});

describe("similarityScore", () => {
  it("exact match scores 100", () => {
    expect(similarityScore("reluctant", "reluctant")).toBe(100);
  });
  it("target as a whole token in a phrase scores 100", () => {
    expect(similarityScore("the word reluctant", "reluctant")).toBe(100);
  });
  it("a plural/one-letter near-miss scores high", () => {
    expect(similarityScore("pollinations", "pollination")).toBeGreaterThanOrEqual(80);
    expect(similarityScore("reluctent", "reluctant")).toBeGreaterThanOrEqual(80);
  });
  it("an unrelated word scores below the pass bar", () => {
    // Clearly wrong words land under the default 70 pass threshold (→ needs-work),
    // well below the 80+ a real near-miss earns.
    expect(similarityScore("elephant", "reluctant")).toBeLessThan(70);
    expect(similarityScore("dog", "cat")).toBeLessThan(40);
  });
  it("empty transcript scores 0", () => {
    expect(similarityScore("", "reluctant")).toBe(0);
  });
});

describe("wordMatch", () => {
  it("exact match is good with a 100 score and exact flag", () => {
    expect(wordMatch("reluctant", "reluctant")).toEqual({ verdict: "good", exact: true, score: 100 });
  });
  it("target as a token in a short phrase is good", () => {
    expect(wordMatch("the word reluctant", "reluctant").verdict).toBe("good");
  });
  it("a one-letter mishear on a longer word is good (high score)", () => {
    const m = wordMatch("reluctent", "reluctant");
    expect(m.verdict).toBe("good");
    expect(m.score).toBeGreaterThanOrEqual(80);
  });
  it("a clearly different word is needs-work", () => {
    const m = wordMatch("elephant", "reluctant");
    expect(m.verdict).toBe("needs-work");
    expect(m.score).toBeLessThan(70);
  });
  it("short words don't match on a loose 2-edit fluke", () => {
    // "cat" vs "dog" — 3 edits, must not pass.
    expect(wordMatch("dog", "cat").verdict).toBe("needs-work");
  });
  it("empty transcript is needs-work with score 0", () => {
    expect(wordMatch("", "reluctant")).toEqual({ verdict: "needs-work", exact: false, score: 0 });
  });
  it("verdict tracks the supplied threshold", () => {
    // Same closeness, different bar: a high threshold flips a marginal match.
    const heard = "reluctantly";
    const lenient = wordMatch(heard, "reluctant", 40);
    const strict = wordMatch(heard, "reluctant", 99);
    expect(lenient.verdict).toBe("good");
    expect(strict.verdict).toBe("needs-work");
    expect(lenient.score).toBe(strict.score); // score is threshold-independent
  });
});
