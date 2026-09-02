import { describe, it, expect } from "vitest";
import { pickInitialId } from "../lib/writing/deeplink";

/*
 * The writing page deep-links each question via `?q=<id>` so it can be referred
 * to / shared. pickInitialId decides which question is selected on load.
 */
describe("pickInitialId (writing question deep link)", () => {
  const prompts = [{ id: "a" }, { id: "b" }, { id: "c" }];

  it("selects the ?q= target when it is in the visible list", () => {
    expect(pickInitialId(prompts, "b")).toBe("b");
  });

  it("falls back to the first question when ?q= is absent", () => {
    expect(pickInitialId(prompts, null)).toBe("a");
  });

  it("falls back to the first when ?q= names a question not visible to the viewer", () => {
    // e.g. a link to someone else's private prompt — privacy is preserved.
    expect(pickInitialId(prompts, "private-x")).toBe("a");
  });

  it("is null when there are no questions", () => {
    expect(pickInitialId([], "b")).toBeNull();
    expect(pickInitialId([], null)).toBeNull();
  });
});
