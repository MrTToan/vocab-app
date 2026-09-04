import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import type { Word } from "@/lib/types";
import { mockFetch, renderWithSWR } from "./harness";
import PracticePage from "@/app/(app)/practice/page";

/*
 * GUARD — every NON-AI (locally-graded) exercise type must, on "Check", RENDER a
 * verdict panel and NOT silently auto-advance to the next word. This is the
 * invariant the captain's "cloze jumps to the next question, no verdict" report
 * turned out NOT to violate in code (that was stale cached JS, fixed in
 * proxy.ts) — this test locks it so a future refactor of the local-grade path
 * can't regress it.
 *
 * A non-AI Check goes gradeLocal()/gradeFlashcard() -> record() -> status
 * "feedback"; it posts /api/practice/result but must NOT fire another
 * /api/practice/next as an ADVANCE. `/next` legitimately fires as a load-time
 * PREFETCH when a word is presented, so we compare the count right after the
 * word renders (baseline) with the count after Check — the delta must be 0.
 */

const BASE: Word = {
  id: "w1", word: "resilient", part_of_speech: "adjective", ipa: "/rɪˈzɪliənt/",
  vi_meaning: "kiên cường", definition_en: "recovers quickly", synonyms: [],
  collocations: ["highly resilient"], example_simple: "a resilient team",
  example_complex: "", false_friend_note: "", personal_note: "", tags: [],
  source: "manual", owner_id: "__system__", stage: "recognition", times_seen: 2,
  recent_results: ["correct"], last_seen_at: null, created_at: Date.now(),
};

const SECOND = {
  word: { ...BASE, id: "w2", word: "brittle", vi_meaning: "giòn" },
  exerciseType: "type_from_definition",
  generated: {},
};

beforeEach(() => { try { window.localStorage.clear(); } catch { /* */ } });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

/** Render `first`, fill the answer, click Check, assert verdict + no advance. */
async function checkShowsVerdictNoAdvance(opts: {
  first: { word: Word; exerciseType: string; generated: Record<string, unknown> };
  promptProbe: RegExp;
  inputPlaceholder: string;
  answer: string;
}) {
  let nextCalls = 0;
  mockFetch({
    "GET /api/collections": { collections: [], memberships: [], owner: false },
    "POST /api/practice/next": () => { nextCalls++; return nextCalls === 1 ? opts.first : SECOND; },
    "POST /api/practice/result": { from: "recognition", stage: "recall" },
  });

  renderWithSWR(<PracticePage />);
  await screen.findByText(opts.promptProbe);
  const nextAtLoad = nextCalls; // mount + prefetch already fired

  fireEvent.change(screen.getByPlaceholderText(opts.inputPlaceholder), {
    target: { value: opts.answer },
  });
  fireEvent.click(await screen.findByRole("button", { name: "Check" }));

  await waitFor(() =>
    expect(screen.getByText(/^(Correct|Almost|Not quite)$/)).toBeTruthy(),
  );
  // The user advances, not the app.
  expect(screen.getByRole("button", { name: /Next/ })).toBeTruthy();
  // No auto-advance: Check fired no additional /next, and we're still on w1.
  expect(nextCalls - nextAtLoad).toBe(0);
  expect(screen.queryByText("brittle")).toBeNull();
}

describe("PracticePage — non-AI Check shows a verdict and does not auto-advance", () => {
  it("cloze (fill in the blank)", async () => {
    await checkShowsVerdictNoAdvance({
      first: {
        word: BASE,
        exerciseType: "cloze",
        generated: { cloze_sentence: "The ____ team recovered fast.", answer: "resilient" },
      },
      promptProbe: /Fill the blank/,
      inputPlaceholder: "Your answer…",
      answer: "wrongword",
    });
  });

  it("type_from_definition", async () => {
    await checkShowsVerdictNoAdvance({
      first: { word: BASE, exerciseType: "type_from_definition", generated: {} },
      promptProbe: /Type the English word/,
      inputPlaceholder: "Your answer…",
      answer: "wrongword",
    });
  });

  it("flashcard (VN→EN typed)", async () => {
    // flashDir is Math.random() < 0.5 ? "vn2en" : "en2vn" (page.tsx toCurrent).
    // Force vn2en so it grades via gradeEnglishWord -> record directly (the
    // en2vn miss path opens a confirm dialog instead, a separate flow).
    vi.spyOn(Math, "random").mockReturnValue(0.1);
    await checkShowsVerdictNoAdvance({
      first: { word: BASE, exerciseType: "flashcard", generated: {} },
      promptProbe: /Vietnamese → English/,
      inputPlaceholder: "Type the English word…",
      answer: "wrongword",
    });
  });
});
