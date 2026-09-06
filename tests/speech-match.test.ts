import { describe, it, expect } from "vitest";
import {
  normalize,
  editDistance,
  wordMatch,
  similarityScore,
  phoneticKey,
  sentenceCompleteness,
  sentenceSimilarity,
  sentenceMatch,
} from "@/lib/speech/match";

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

/*
 * The "say sentence" fallback matcher (OpenAI path). Unlike wordMatch, one
 * matching token must NOT score the whole sentence 100 — a sentence blends overall
 * closeness with how many of its words were actually said (completeness).
 */
const REF = "She was reluctant to leave the party early.";

describe("sentenceCompleteness", () => {
  it("is 1 when every reference word is present", () => {
    expect(sentenceCompleteness(REF, REF)).toBe(1);
  });
  it("counts near-miss word forms as covered (order-tolerant)", () => {
    // Word order shuffled + a plural inflection; all words still accounted for.
    expect(sentenceCompleteness("reluctant she was to leave the parties early", REF)).toBeGreaterThanOrEqual(0.85);
  });
  it("drops when most of the sentence is missing", () => {
    expect(sentenceCompleteness("reluctant", REF)).toBeLessThan(0.3);
  });
  it("is 0 for an unrelated sentence", () => {
    expect(sentenceCompleteness("the dog ran across the road", REF)).toBeLessThan(0.3);
  });
});

describe("sentenceSimilarity", () => {
  it("an exact read scores 100 with full completeness", () => {
    expect(sentenceSimilarity(REF, REF)).toEqual({ score: 100, completeness: 100 });
  });
  it("a full sentence with the target words present scores high", () => {
    const { score } = sentenceSimilarity("She was reluctant to leave the party early", REF);
    expect(score).toBeGreaterThanOrEqual(90);
  });
  it("saying only ONE matching word does NOT score the sentence high", () => {
    // Word-level, that one word IS the whole target → 100; but as a SENTENCE read,
    // saying a single word out of nine is nowhere near complete.
    expect(similarityScore("reluctant", "reluctant")).toBe(100); // (word-level: full marks…)
    expect(sentenceSimilarity("reluctant", REF).score).toBeLessThan(60); // …but the sentence isn't.
  });
  it("a wrong/garbled sentence scores low", () => {
    expect(sentenceSimilarity("the dog ran across the road", REF).score).toBeLessThan(45);
  });
  it("an empty transcript scores 0", () => {
    expect(sentenceSimilarity("", REF)).toEqual({ score: 0, completeness: 0 });
  });
});

describe("sentenceMatch", () => {
  it("a faithful read is good", () => {
    const m = sentenceMatch("She was reluctant to leave the party early", REF);
    expect(m.verdict).toBe("good");
    expect(m.score).toBeGreaterThanOrEqual(80);
    expect(m.completeness).toBeGreaterThanOrEqual(90);
  });
  it("a garbled sentence is needs-work with a low score", () => {
    const m = sentenceMatch("the dog ran across the road", REF);
    expect(m.verdict).toBe("needs-work");
    expect(m.score).toBeLessThan(70);
  });
  it("verdict tracks the supplied threshold", () => {
    const heard = "she was reluctant to leave";
    expect(sentenceMatch(heard, REF, 40).verdict).toBe("good");
    expect(sentenceMatch(heard, REF, 99).verdict).toBe("needs-work");
    expect(sentenceMatch(heard, REF, 40).score).toBe(sentenceMatch(heard, REF, 99).score);
  });
});
