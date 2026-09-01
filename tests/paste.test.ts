import { describe, it, expect } from "vitest";
import { parsePasteList } from "../lib/paste";

describe("parsePasteList", () => {
  it("splits on newlines", () => {
    const { words } = parsePasteList("apple\nbanana\ncherry");
    expect(words).toEqual(["apple", "banana", "cherry"]);
  });

  it("splits on commas", () => {
    const { words } = parsePasteList("apple, banana, cherry");
    expect(words).toEqual(["apple", "banana", "cherry"]);
  });

  it("splits on a mix of newlines and commas", () => {
    const { words } = parsePasteList("apple, banana\ncherry,date");
    expect(words).toEqual(["apple", "banana", "cherry", "date"]);
  });

  it("trims whitespace around each word", () => {
    const { words } = parsePasteList("  apple  ,\t banana \n  cherry ");
    expect(words).toEqual(["apple", "banana", "cherry"]);
  });

  it("drops blank entries and collapses repeated separators", () => {
    const { words } = parsePasteList("apple,,,\n\n , banana");
    expect(words).toEqual(["apple", "banana"]);
  });

  it("drops case-insensitive duplicates, keeping first-seen casing", () => {
    const { words, duplicatesInPaste } = parsePasteList("Apple\napple\nAPPLE\nbanana");
    expect(words).toEqual(["Apple", "banana"]);
    expect(duplicatesInPaste).toBe(2);
  });

  it("preserves multi-word phrases (only splits on commas/newlines)", () => {
    const { words } = parsePasteList("spinal cord\nget away with");
    expect(words).toEqual(["spinal cord", "get away with"]);
  });

  it("handles empty and whitespace-only input", () => {
    expect(parsePasteList("").words).toEqual([]);
    expect(parsePasteList("   \n \t ").words).toEqual([]);
    expect(parsePasteList("").duplicatesInPaste).toBe(0);
  });

  it("tolerates trailing/leading separators", () => {
    const { words } = parsePasteList(",apple,banana,\n");
    expect(words).toEqual(["apple", "banana"]);
  });
});
