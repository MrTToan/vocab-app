import { describe, it, expect } from "vitest";
import { lemma, dedupeByLemma, normalizeText } from "../lib/lemma";

describe("lemma() — inflection folding (merges these)", () => {
  it.each([
    ["run", "running"],
    ["run", "runs"],
    ["run", "ran"], // irregular
    ["walk", "walked"],
    ["walk", "walking"],
    ["stop", "stopped"], // de-double
    ["stop", "stopping"],
    ["study", "studies"],
    ["study", "studied"],
    ["try", "tries"],
    ["box", "boxes"],
    ["wish", "wishes"],
    ["match", "matches"],
    ["glass", "glasses"],
    ["cat", "cats"],
    ["car", "cars"],
    ["name", "names"],
    ["agree", "agreed"], // -eed keeps the e
    ["child", "children"], // irregular plural
    ["foot", "feet"],
    ["mouse", "mice"],
    ["go", "went"], // irregular verb
    ["write", "wrote"],
    ["write", "written"],
    ["read", "reading"],
  ])("%s ≡ %s", (base, inflected) => {
    expect(lemma(inflected)).toBe(lemma(base));
  });

  it("is idempotent for the words it touches", () => {
    for (const w of ["running", "studies", "boxes", "children", "walked"]) {
      expect(lemma(lemma(w))).toBe(lemma(w));
    }
  });

  it("is case/whitespace-insensitive", () => {
    expect(lemma("  Running ")).toBe(lemma("run"));
    expect(lemma("RUNS")).toBe(lemma("run"));
  });
});

describe("lemma() — conservative: clearly-distinct words stay separate", () => {
  it.each([
    // derivational suffixes are NOT stripped
    ["quick", "quickly"],
    ["happy", "happiness"],
    ["run", "runner"],
    ["big", "bigger"],
    ["nation", "national"],
    // short words / homographs guarded
    ["us", "used"], // -ed guard: "us" ≠ "use" ≠ "used"
    ["is", "island"],
    ["bus", "business"],
    // invariant -s words are not stemmed to a fake singular
    ["news", "new"],
    ["series", "serie"],
    // genuinely different words
    ["car", "care"],
    ["back", "bake"],
    ["ring", "run"],
  ])("%s ≠ %s", (a, b) => {
    expect(lemma(a)).not.toBe(lemma(b));
  });

  it("does not stem short -ing nouns", () => {
    expect(lemma("thing")).toBe("thing");
    expect(lemma("king")).toBe("king");
    expect(lemma("sing")).toBe("sing");
  });

  it("leaves phrases and hyphenated compounds as normalized text", () => {
    expect(lemma("get away with")).toBe("get away with");
    expect(lemma("  Get  Away  With ")).toBe("get away with");
    expect(lemma("self-aware")).toBe("self-aware");
    // a phrase is NOT lemmatized word-by-word (safe under-merge)
    expect(lemma("side effects")).not.toBe(lemma("side effect"));
  });
});

describe("dedupeByLemma()", () => {
  it("collapses inflections within a list, keeping first-seen surface form", () => {
    const { unique, duplicateCount } = dedupeByLemma([
      "run",
      "running",
      "RUNS",
      "walk",
      "walked",
    ]);
    expect(unique).toEqual(["run", "walk"]);
    expect(duplicateCount).toBe(3);
  });

  it("drops blanks and reports zero duplicates for a clean list", () => {
    const { unique, duplicateCount } = dedupeByLemma(["apple", "", "  ", "banana"]);
    expect(unique).toEqual(["apple", "banana"]);
    expect(duplicateCount).toBe(0);
  });

  it("keeps distinct words that only share a prefix", () => {
    const { unique } = dedupeByLemma(["universe", "university"]);
    expect(unique).toEqual(["universe", "university"]);
  });
});

describe("normalizeText()", () => {
  it("lowercases, trims and collapses whitespace", () => {
    expect(normalizeText("  Hello   World ")).toBe("hello world");
  });
});
