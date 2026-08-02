import { describe, it, expect } from "vitest";
import {
  clozeFromSentence,
  clozeRaw,
  translateQuestion,
  scenarioQuestion,
  saveHarvest,
} from "../lib/harvest";

describe("harvest builders", () => {
  it("clozeFromSentence builds a cloze with a deterministic id", () => {
    const q = clozeFromSentence("w1", "receive", "I receive mail.");
    expect(q).toMatchObject({
      word_id: "w1",
      type: "cloze",
      payload: "I ____ mail.",
      answer: "receive",
    });
    const again = clozeFromSentence("w1", "receive", "I receive mail.");
    expect(again!.id).toBe(q!.id); // same sentence -> same id -> dedup
  });

  it("clozeFromSentence returns null when the word is absent", () => {
    expect(clozeFromSentence("w1", "receive", "I got mail.")).toBeNull();
  });

  it("clozeRaw requires an existing blank", () => {
    expect(clozeRaw("w1", "no blank here", "x")).toBeNull();
    expect(clozeRaw("w1", "a ____ b", "mid")).toMatchObject({
      type: "cloze",
      payload: "a ____ b",
      answer: "mid",
    });
  });

  it("translateQuestion carries direction and an empty answer", () => {
    expect(translateQuestion("w1", "vn_to_en", "Xin chào")).toMatchObject({
      type: "translate",
      direction: "vn_to_en",
      payload: "Xin chào",
      answer: "",
    });
  });

  it("scenarioQuestion builds a scenario item", () => {
    expect(scenarioQuestion("w1", "Apologize formally.")).toMatchObject({
      type: "scenario",
      payload: "Apologize formally.",
    });
  });

  it("builders return null on empty input", () => {
    expect(translateQuestion("w1", "en_to_vn", "  ")).toBeNull();
    expect(scenarioQuestion("w1", "")).toBeNull();
  });
});

describe("saveHarvest", () => {
  it("filters nulls and calls addQuestions once with the real items", async () => {
    const calls: unknown[][] = [];
    const store = {
      addQuestions: async (qs: never[]) => {
        calls.push(qs);
      },
    };
    saveHarvest(store, [
      scenarioQuestion("w1", "x"),
      null,
      translateQuestion("w1", "en_to_vn", "y"),
    ]);
    await Promise.resolve();
    expect(calls.length).toBe(1);
    expect(calls[0].length).toBe(2);
  });

  it("does nothing when every item is null", () => {
    let called = false;
    const store = {
      addQuestions: async () => {
        called = true;
      },
    };
    saveHarvest(store, [null, null]);
    expect(called).toBe(false);
  });
});
