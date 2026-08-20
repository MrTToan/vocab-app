import { describe, it, expect } from "vitest";
import { recentAccuracy, isWeak, stageBarWidth } from "../lib/ui";
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

describe("stageBarWidth", () => {
  it("renders 'new' as a full backlog bar regardless of size", () => {
    expect(stageBarWidth("new", { new: 9999, recognition: 5 })).toBe(100);
    expect(stageBarWidth("new", {})).toBe(100);
  });

  it("scales started stages against the largest STARTED stage, ignoring 'new'", () => {
    // recognition is the biggest started stage (20); recall (10) -> 50%
    const counts = { new: 9999, recognition: 20, recall: 10, production: 0, known: 0 };
    expect(stageBarWidth("recognition", counts)).toBe(100);
    expect(stageBarWidth("recall", counts)).toBe(50);
    expect(stageBarWidth("production", counts)).toBe(0);
  });

  it("does not divide by zero when no started stage has words", () => {
    expect(stageBarWidth("recognition", { new: 100 })).toBe(0);
  });
});
