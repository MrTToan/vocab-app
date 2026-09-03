import { describe, it, expect } from "vitest";
import {
  weightedAccuracy,
  weightedAccuracyPct,
  dailyAccuracy,
  weekOverWeek,
  rankTypesByAccuracy,
  masteryPipeline,
  streakDots,
} from "../lib/report";
import type { DayBucket, TypeBucket } from "../lib/stats";

const day = (label: string, correct: number, partial: number, incorrect: number): DayBucket => ({
  label, correct, partial, incorrect, total: correct + partial + incorrect,
});
const typ = (type: string, correct: number, partial: number, incorrect: number): TypeBucket => ({
  type, correct, partial, incorrect, total: correct + partial + incorrect,
});

describe("weightedAccuracy", () => {
  it("is 0 with no attempts", () => {
    expect(weightedAccuracy({ correct: 0, partial: 0, incorrect: 0 })).toBe(0);
    expect(weightedAccuracyPct({ correct: 0, partial: 0, incorrect: 0 })).toBe(0);
  });
  it("weights correct=1, partial=0.5, incorrect=0", () => {
    expect(weightedAccuracy({ correct: 1, partial: 0, incorrect: 1 })).toBe(0.5);
    expect(weightedAccuracyPct({ correct: 1, partial: 1, incorrect: 0 })).toBe(75);
  });
  it("rounds to an integer percent", () => {
    // (2 + 0.5)/3 = 0.8333 -> 83
    expect(weightedAccuracyPct({ correct: 2, partial: 1, incorrect: 0 })).toBe(83);
  });
});

describe("dailyAccuracy", () => {
  it("returns null pct on days with no attempts (line gap), preserving label/total", () => {
    const out = dailyAccuracy([day("8/1", 0, 0, 0), day("8/2", 3, 0, 1)]);
    expect(out[0]).toEqual({ label: "8/1", total: 0, pct: null });
    expect(out[1]).toEqual({ label: "8/2", total: 4, pct: 75 });
  });
});

describe("weekOverWeek", () => {
  it("compares the newest half against the older half", () => {
    const older = Array.from({ length: 7 }, (_, i) => day(`o${i}`, 1, 0, 1)); // 50%
    const newer = Array.from({ length: 7 }, (_, i) => day(`n${i}`, 4, 0, 1)); // 80%
    const r = weekOverWeek([...older, ...newer]);
    expect(r.previous).toBe(50);
    expect(r.current).toBe(80);
    expect(r.deltaPts).toBe(30);
  });
  it("is null when a side has no attempts", () => {
    const older = Array.from({ length: 7 }, (_, i) => day(`o${i}`, 1, 0, 1));
    const newerEmpty = Array.from({ length: 7 }, (_, i) => day(`n${i}`, 0, 0, 0));
    const r = weekOverWeek([...older, ...newerEmpty]);
    expect(r.current).toBeNull();
    expect(r.deltaPts).toBeNull();
    expect(r.previous).toBe(50);
  });
});

describe("rankTypesByAccuracy (min-attempts guard)", () => {
  it("keeps a tiny-sample type off the top of the weak list", () => {
    const ranked = rankTypesByAccuracy([
      typ("flashcard", 88, 0, 12), // 88%, 100 attempts
      typ("cloze", 30, 0, 20), // 60%, 50 attempts
      typ("scenario", 0, 0, 2), // 0%, only 2 attempts -> low sample
    ], 10);
    // reliable types come first, weakest reliable first; the 2-attempt 0% type is last
    expect(ranked.map((r) => r.type)).toEqual(["cloze", "flashcard", "scenario"]);
    expect(ranked[2].lowSample).toBe(true);
    expect(ranked[0].lowSample).toBe(false);
  });
});

describe("masteryPipeline", () => {
  it("places every word on New->Known and sums fractions to 1", () => {
    const { segments, total, knownPct } = masteryPipeline({
      new: 120, recognition: 70, recall: 60, production: 50, known: 40,
    });
    expect(total).toBe(340);
    expect(segments.map((s) => s.stage)).toEqual(["new", "recognition", "recall", "production", "known"]);
    expect(segments.find((s) => s.stage === "known")!.count).toBe(40);
    expect(knownPct).toBe(Math.round((40 / 340) * 100)); // 12
    const fracSum = segments.reduce((a, s) => a + s.fraction, 0);
    expect(fracSum).toBeCloseTo(1, 10);
  });
  it("handles an empty library without dividing by zero", () => {
    const { total, knownPct, segments } = masteryPipeline({});
    expect(total).toBe(0);
    expect(knownPct).toBe(0);
    expect(segments.every((s) => s.fraction === 0 && s.count === 0)).toBe(true);
  });
});

describe("streakDots", () => {
  it("marks days with at least one attempt", () => {
    expect(streakDots([day("a", 1, 0, 0), day("b", 0, 0, 0), day("c", 0, 1, 0)])).toEqual([true, false, true]);
  });
});
