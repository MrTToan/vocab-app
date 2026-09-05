import { describe, it, expect } from "vitest";
import { normalize, editDistance, wordMatch } from "@/lib/speech/match";

/*
 * The OpenAI-fallback "say it" verdict is a WORD-MATCH check on the Whisper
 * transcript (no phoneme scoring). These pin the normalization + tolerance so a
 * mis-heard letter still passes but a genuinely wrong word doesn't.
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

describe("wordMatch", () => {
  it("exact match is good", () => {
    expect(wordMatch("reluctant", "reluctant")).toEqual({ verdict: "good", exact: true });
  });
  it("target as a token in a short phrase is good", () => {
    expect(wordMatch("the word reluctant", "reluctant").verdict).toBe("good");
  });
  it("a one-letter mishear on a longer word is good (near-miss)", () => {
    expect(wordMatch("reluctent", "reluctant").verdict).toBe("good");
  });
  it("a clearly different word is needs-work", () => {
    expect(wordMatch("elephant", "reluctant").verdict).toBe("needs-work");
  });
  it("short words don't match on a loose 2-edit fluke", () => {
    // "cat" vs "dog" — 3 edits, must not pass.
    expect(wordMatch("dog", "cat").verdict).toBe("needs-work");
  });
  it("empty transcript is needs-work", () => {
    expect(wordMatch("", "reluctant").verdict).toBe("needs-work");
  });
});
