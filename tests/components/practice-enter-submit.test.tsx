import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import type { Word } from "@/lib/types";
import { mockFetch, renderWithSWR } from "./harness";
import PracticePage from "@/app/(app)/practice/page";

/*
 * REGRESSION — "/practice: pressing Enter to submit a short answer auto-advances
 * past the verdict." Clicking "Check" with the mouse worked; only Enter broke it
 * (why it "worked on mobile" but not on laptop).
 *
 * Mechanism: the input's onKeyDown submits (status → "feedback"), the feedback
 * panel's "Next →" button mounts, and — with the old `autoFocus` — grabbed focus
 * mid-keystroke, so the SAME physical Enter activated it (a browser fires a click
 * when Enter lands on a focused button) → advance() → the verdict is skipped.
 *
 * `pressEnter` below faithfully replays one physical Enter: the keydown submits,
 * and if that hands focus to a button (the old autoFocus bug), the same Enter
 * activates it exactly as a real browser would. On the buggy code that click
 * fires and the verdict is skipped; on the fix, focus is deferred to the next
 * frame so the submitting keystroke finishes on nothing and the verdict stays.
 */

const BASE: Word = {
  id: "w1",
  word: "reluctant",
  part_of_speech: "adjective",
  ipa: "/rɪˈlʌktənt/",
  vi_meaning: "miễn cưỡng",
  definition_en: "unwilling",
  synonyms: [],
  collocations: [],
  example_simple: "",
  example_complex: "",
  false_friend_note: "",
  personal_note: "",
  tags: [],
  source: "manual",
  owner_id: "__system__",
  stage: "recall",
  times_seen: 3,
  recent_results: ["correct"],
  last_seen_at: null,
  created_at: Date.now(),
};

/** One physical Enter press, faithfully replayed (see file header). */
function pressEnter(el: Element) {
  (el as HTMLElement).focus();
  fireEvent.keyDown(el, { key: "Enter" });
  // A browser fires a click when Enter lands on a focused button. If focus is on
  // a button after the keydown — because it started there, or because the old
  // autoFocus grabbed it mid-keystroke — replay that activation.
  const active = document.activeElement;
  if (active && active.tagName === "BUTTON") {
    fireEvent.click(active);
  }
}

beforeEach(() => {
  try {
    window.localStorage.clear();
  } catch {
    /* ignore */
  }
  // Force flashcard direction to VN→EN (Math.random() < 0.5) so a typed English
  // answer is graded locally — otherwise EN→VN routes through the confirm screen.
  vi.spyOn(Math, "random").mockReturnValue(0);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/**
 * A short typed-input exercise. Two words back-to-back so we can prove the page
 * did NOT advance: word #2 (`nuance`) must never appear after a single Enter.
 */
function stubShortExercise(exerciseType: string, generated: Record<string, unknown> = {}) {
  const first = { ...BASE, id: "w1", word: "reluctant", vi_meaning: "miễn cưỡng" };
  const second = { ...BASE, id: "w2", word: "nuance", vi_meaning: "sắc thái" };
  let served = 0;
  const nextMock = vi.fn(() => {
    served += 1;
    return {
      word: served === 1 ? first : second,
      exerciseType,
      generated,
    };
  });
  const resultMock = vi.fn(() => ({ from: "recall", stage: "recall" }));
  mockFetch({
    "GET /api/collections": { collections: [], memberships: [], owner: false },
    "POST /api/practice/next": nextMock,
    "POST /api/practice/result": resultMock,
  });
  return { resultMock };
}

describe("PracticePage — Enter-to-submit shows the verdict and does not auto-advance", () => {
  it.each([
    ["type_from_definition", {} as Record<string, unknown>, "reluctant"],
    ["cloze", { cloze_sentence: "She was ____ to leave.", answer: "reluctant" }, "reluctant"],
    ["flashcard", {}, "reluctant"],
  ])("%s: a single Enter shows feedback and stays", async (exerciseType, generated) => {
    stubShortExercise(exerciseType, generated);

    renderWithSWR(<PracticePage />);

    const input = await screen.findByPlaceholderText(/answer|word|meaning/i);
    fireEvent.change(input, { target: { value: "reluctant" } });

    // A single Enter: submit only. Must NOT roll through to "Next".
    pressEnter(input);

    // The verdict panel is shown and STAYS (a mouse click would do the same).
    // If Enter had rolled through to "Next", advance() would have cleared this.
    await screen.findByText("Correct");
    // "Next →" exists (we are on the feedback screen) but we did NOT advance:
    expect(screen.getByRole("button", { name: /Next/ })).toBeTruthy();
    // Word #2's meaning ("sắc thái") shows only once its prompt renders — it must
    // NOT be present, proving no auto-advance happened.
    expect(screen.queryByText(/sắc thái/)).toBeNull();
  });

  it("does not focus the Next button synchronously on the submitting keystroke", async () => {
    stubShortExercise("type_from_definition");
    renderWithSWR(<PracticePage />);

    const input = await screen.findByPlaceholderText(/answer|word|meaning/i);
    fireEvent.change(input, { target: { value: "reluctant" } });
    fireEvent.keyDown(input, { key: "Enter" });

    // The verdict is up…
    await screen.findByText("Correct");
    const next = screen.getByRole("button", { name: /Next/ });
    // …but focus must NOT have jumped to Next during the submitting keystroke
    // (that synchronous focus was the bleed-through vector).
    expect(document.activeElement).not.toBe(next);
  });

  it("a fresh, deliberate Enter after the verdict advances to the next word", async () => {
    stubShortExercise("type_from_definition");
    renderWithSWR(<PracticePage />);

    const input = await screen.findByPlaceholderText(/answer|word|meaning/i);
    fireEvent.change(input, { target: { value: "reluctant" } });
    pressEnter(input);

    const next = await screen.findByRole("button", { name: /Next/ });
    // Focus lands on Next a frame later (keyboard users can act on it).
    await waitFor(() => expect(document.activeElement).toBe(next));

    // A second, deliberate Enter (or click) advances to word #2 — whose meaning
    // ("sắc thái") appears once its prompt renders.
    pressEnter(next);
    await screen.findByText(/sắc thái/);
  });
});
