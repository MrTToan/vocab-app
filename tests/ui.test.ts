import { describe, it, expect } from "vitest";
import { recentAccuracy, isWeak } from "../lib/ui";
import { mkWord } from "./factory";

describe("recentAccuracy (ui)", () => {
  it("is 0 with no history", () => {
    expect(recentAccuracy({ recent_results: [] })).toBe(0);
  });
  it("weights correct=1, partial=0.5, incorrect=0", () => {
    expect(recentAccuracy({ recent_results: ["correct", "incorrect"] })).toBe(0.5);
  });
});

describe("isWeak", () => {
  it("is false for a word with no history", () => {
    expect(isWeak(mkWord({ recent_results: [] }))).toBe(false);
  });
  it("is true when the most recent result was incorrect", () => {
    expect(isWeak(mkWord({ recent_results: ["correct", "incorrect"] }))).toBe(true);
  });
  it("is true when recent accuracy is below 0.6", () => {
    // last is 'correct' (so not flagged by the last-result rule) but accuracy 0.5 < 0.6
    expect(isWeak(mkWord({ recent_results: ["incorrect", "correct"] }))).toBe(true);
  });
  it("is false when the word is answered well", () => {
    expect(isWeak(mkWord({ recent_results: ["correct", "correct"] }))).toBe(false);
  });
});
