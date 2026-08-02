import { describe, it, expect } from "vitest";
import {
  norm,
  levenshtein,
  isClose,
  gradeEnglishWord,
  stripDiacritics,
  normVi,
  matchesMeaning,
} from "../lib/grade";

describe("norm", () => {
  it("trims, lowercases, collapses spaces", () => {
    expect(norm("  Hello  World  ")).toBe("hello world");
  });
  it("drops trailing punctuation only", () => {
    expect(norm("word!?")).toBe("word");
    expect(norm("it's")).toBe("it's"); // apostrophe mid-word kept
  });
});

describe("levenshtein", () => {
  it("is 0 for identical strings", () => {
    expect(levenshtein("cat", "cat")).toBe(0);
  });
  it("counts single edits", () => {
    expect(levenshtein("cat", "cot")).toBe(1); // substitution
    expect(levenshtein("cat", "cats")).toBe(1); // insertion
    expect(levenshtein("cats", "cat")).toBe(1); // deletion
  });
  it("handles empty strings", () => {
    expect(levenshtein("", "abc")).toBe(3);
  });
});

describe("isClose", () => {
  it("is false for an exact match (exact is not 'close')", () => {
    expect(isClose("cat", "cat")).toBe(false);
  });
  it("accepts a 1-char typo on short words", () => {
    expect(isClose("cot", "cat")).toBe(true); // len 3 -> tol 1
  });
  it("accepts a 2-char typo on medium words", () => {
    expect(isClose("recieve", "receive")).toBe(true); // transposition, dist 2, len 7 -> tol 2
  });
  it("rejects edits beyond tolerance", () => {
    expect(isClose("cat", "dog")).toBe(false); // dist 3 > tol 1
  });
});

describe("gradeEnglishWord", () => {
  it("returns correct for an exact match ignoring case/punctuation", () => {
    expect(gradeEnglishWord("Dog.", "dog")).toBe("correct");
  });
  it("returns partial for a close typo", () => {
    expect(gradeEnglishWord("recieve", "receive")).toBe("partial");
  });
  it("returns incorrect for a distant answer", () => {
    expect(gradeEnglishWord("cat", "elephant")).toBe("incorrect");
  });
});

describe("stripDiacritics", () => {
  it("removes Vietnamese tone marks and maps đ->d", () => {
    expect(stripDiacritics("nghĩa")).toBe("nghia");
    expect(stripDiacritics("đường")).toBe("duong");
  });
});

describe("normVi", () => {
  it("lowercases, strips diacritics, removes parentheticals and punctuation", () => {
    expect(normVi("Con Đường (chính)!")).toBe("con duong");
  });
});

describe("matchesMeaning", () => {
  it("matches an exact fragment", () => {
    expect(matchesMeaning("con chó", "con chó, chó")).toBe(true);
  });
  it("is diacritic-insensitive", () => {
    expect(matchesMeaning("con cho", "con chó")).toBe(true);
  });
  it("matches a substantial substring of a fragment", () => {
    expect(matchesMeaning("chó", "con chó")).toBe(true);
  });
  it("splits multi-part meanings on comma", () => {
    expect(matchesMeaning("chạy", "đi bộ, chạy, nhảy")).toBe(true);
  });
  it("splits on the connector 'hoặc'", () => {
    expect(matchesMeaning("đẹp", "xinh hoặc đẹp")).toBe(true);
  });
  it("rejects an unrelated answer", () => {
    expect(matchesMeaning("mèo", "con chó")).toBe(false);
  });
  it("rejects answers shorter than 2 chars", () => {
    expect(matchesMeaning("a", "con chó")).toBe(false);
  });
});
