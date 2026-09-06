import { describe, it, expect } from "vitest";
import { toCloze, fillCloze } from "../lib/cloze";

describe("toCloze", () => {
  it("blanks every whole-word occurrence and returns the answer", () => {
    expect(toCloze("I receive mail; you receive mail.", "receive")).toEqual({
      payload: "I ____ mail; you ____ mail.",
      answer: "receive",
    });
  });
  it("is case-insensitive", () => {
    expect(toCloze("Receive it now.", "receive")?.payload).toBe("____ it now.");
  });
  it("returns null when the word is absent", () => {
    expect(toCloze("I got mail.", "receive")).toBeNull();
  });
  it("does not blank inside a larger word (whole-word only)", () => {
    expect(toCloze("I received mail.", "receive")).toBeNull();
  });
  it("handles multi-word phrases", () => {
    expect(toCloze("They cater to tourists.", "cater to")?.payload).toBe(
      "They ____ tourists.",
    );
  });
  it("returns null for empty input", () => {
    expect(toCloze("", "x")).toBeNull();
    expect(toCloze("hello", "")).toBeNull();
  });
});

describe("fillCloze", () => {
  it("fills the blank back in with the answer (round-trips toCloze)", () => {
    expect(fillCloze("She was ____ to leave.", "reluctant")).toBe("She was reluctant to leave.");
  });
  it("fills every blank", () => {
    expect(fillCloze("I ____ mail; you ____ mail.", "receive")).toBe(
      "I receive mail; you receive mail.",
    );
  });
  it("returns null when there is no blank, sentence, or answer", () => {
    expect(fillCloze("No blank here.", "x")).toBeNull();
    expect(fillCloze("", "x")).toBeNull();
    expect(fillCloze("A ____ b", "")).toBeNull();
  });
});
