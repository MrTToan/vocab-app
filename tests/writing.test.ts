import { describe, it, expect } from "vitest";
import {
  countWords,
  clampBand,
  normalizeErrorType,
  normalizeCriterion,
  locateCorrections,
  aggregateErrors,
  normalizeScore,
} from "../lib/writing/grade";
import type { WritingScoreRaw } from "../lib/writing/types";

describe("countWords", () => {
  it("counts whitespace-separated tokens with a letter/digit", () => {
    expect(countWords("The cat sat on the mat")).toBe(6);
    expect(countWords("  spaced   out  words ")).toBe(3);
    expect(countWords("")).toBe(0);
  });
  it("ignores standalone punctuation but keeps hyphenated/contracted words", () => {
    expect(countWords("well-being isn't easy — really")).toBe(4); // em dash isn't a word
    expect(countWords("data: 22% rose")).toBe(3);
  });
});

describe("clampBand", () => {
  it("rounds to the nearest half band", () => {
    expect(clampBand(6.3)).toBe(6.5);
    expect(clampBand(6.24)).toBe(6);
    expect(clampBand(7.75)).toBe(8);
  });
  it("clamps to 0..9 and handles junk", () => {
    expect(clampBand(-2)).toBe(0);
    expect(clampBand(99)).toBe(9);
    expect(clampBand(NaN)).toBe(0);
  });
});

describe("normalizeErrorType / normalizeCriterion", () => {
  it("maps known values (with spaces/dashes/case)", () => {
    expect(normalizeErrorType("Subject-Verb Agreement")).toBe("subject_verb_agreement");
    expect(normalizeErrorType("TENSE")).toBe("tense");
    expect(normalizeCriterion("Lexical Resource")).toBe("lexical_resource");
  });
  it("falls back for unknown values", () => {
    expect(normalizeErrorType("vibes")).toBe("other");
    expect(normalizeCriterion("nonsense")).toBe("task_achievement");
  });
});

describe("locateCorrections", () => {
  const text = "I has a apple and I has a orange.";
  it("locates spans and normalizes fields", () => {
    const out = locateCorrections(text, [
      { original: "a apple", suggestion: "an apple", error_type: "Article", criterion: "grammatical_range_accuracy", explanation: "x" },
    ]);
    expect(out[0].start).toBe(text.indexOf("a apple"));
    expect(out[0].end).toBe(text.indexOf("a apple") + "a apple".length);
    expect(out[0].error_type).toBe("article");
  });
  it("matches duplicates left-to-right without reusing a span", () => {
    const out = locateCorrections(text, [
      { original: "I has", suggestion: "I have", error_type: "tense", criterion: "grammatical_range_accuracy", explanation: "" },
      { original: "I has", suggestion: "I have", error_type: "tense", criterion: "grammatical_range_accuracy", explanation: "" },
    ]);
    expect(out[0].start).toBe(0);
    expect(out[1].start).toBe(text.indexOf("I has", 1));
    expect(out[0].start).not.toBe(out[1].start);
  });
  it("returns null span when the original is not found", () => {
    const out = locateCorrections(text, [
      { original: "zebra", suggestion: "z", error_type: "other", criterion: "task_achievement", explanation: "" },
    ]);
    expect(out[0].start).toBeNull();
    expect(out[0].end).toBeNull();
  });
  it("is case-insensitive as a fallback", () => {
    const out = locateCorrections("Hello world", [
      { original: "hello", suggestion: "Hi", error_type: "other", criterion: "task_achievement", explanation: "" },
    ]);
    expect(out[0].start).toBe(0);
  });
});

describe("aggregateErrors", () => {
  it("counts by type, descending", () => {
    const agg = aggregateErrors([
      { error_type: "tense" }, { error_type: "tense" }, { error_type: "article" },
    ] as any);
    expect(agg[0]).toEqual({ error_type: "tense", count: 2 });
    expect(agg[1]).toEqual({ error_type: "article", count: 1 });
  });
});

describe("normalizeScore", () => {
  it("clamps bands and locates corrections", () => {
    const raw: WritingScoreRaw = {
      overall_band: 6.3,
      criteria: {
        task_achievement: { band: 6.1, comment: "a" },
        coherence_cohesion: { band: 7, comment: "b" },
        lexical_resource: { band: 5.4, comment: "c" },
        grammatical_range_accuracy: { band: 12, comment: "d" },
      },
      corrections: [
        { original: "cat", suggestion: "cats", error_type: "Tense", criterion: "grammatical_range_accuracy", explanation: "" },
      ],
      strengths: ["good"],
      general_feedback: "improve",
    };
    const n = normalizeScore(raw, "the cat sat");
    expect(n.overall_band).toBe(6.5);
    expect(n.bands.grammatical_range_accuracy.band).toBe(9); // clamped
    expect(n.bands.lexical_resource.band).toBe(5.5);
    expect(n.corrections[0].start).toBe(4);
    expect(n.corrections[0].error_type).toBe("tense");
  });
});
