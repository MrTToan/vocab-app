import { describe, it, expect } from "vitest";
import { cleanSpellingSuggestion } from "../lib/spell";

describe("cleanSpellingSuggestion", () => {
  it("passes through a genuine correction", () => {
    expect(cleanSpellingSuggestion("recieve", "receive")).toBe("receive");
  });
  it("returns '' when there is no suggestion", () => {
    expect(cleanSpellingSuggestion("receive", "")).toBe("");
    expect(cleanSpellingSuggestion("receive", "   ")).toBe("");
  });
  it("ignores a suggestion equal to the word (case/space-insensitive)", () => {
    expect(cleanSpellingSuggestion("Receive", "receive")).toBe("");
    expect(cleanSpellingSuggestion("receive", " receive ")).toBe("");
  });
  it("never corrects a multi-word phrase", () => {
    expect(cleanSpellingSuggestion("spinal cord", "spinal chord")).toBe("");
  });
  it("returns '' for non-string input", () => {
    expect(cleanSpellingSuggestion("word", undefined)).toBe("");
    expect(cleanSpellingSuggestion("word", null)).toBe("");
  });
  it("trims the returned suggestion", () => {
    expect(cleanSpellingSuggestion("recieve", "  receive  ")).toBe("receive");
  });
});
