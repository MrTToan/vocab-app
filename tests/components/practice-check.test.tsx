import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import type { Word } from "@/lib/types";
import { mockFetch, renderWithSWR } from "./harness";
import PracticePage from "@/app/(app)/practice/page";

/*
 * REGRESSION for 2.2 — "/practice 'Check my answer' stopped showing the result".
 * The bug lived in the client render/state machine: clicking "Check my answer"
 * scores the answer (server returns {verdict, score}) and the <Feedback>
 * sub-component must render that verdict + score. Every route test was green
 * while this UI was broken, because the break was client-side. This drives the
 * real component: render → type → click → assert the verdict + score render.
 */

const WORD: Word = {
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

/** An LLM-scored exercise so the button reads "Check my answer" and hits /score. */
const NEXT_PAYLOAD = {
  word: WORD,
  exerciseType: "write_sentence",
  generated: {},
};

beforeEach(() => {
  // localStorage is read on mount for the remembered collection.
  try {
    window.localStorage.clear();
  } catch {
    /* ignore */
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PracticePage — Check my answer renders the verdict + score", () => {
  it("shows the LLM verdict and score after checking a written answer", async () => {
    const scoreMock = vi.fn(() => ({
      score: {
        verdict: "pass",
        score: 95,
        reason: "Natural and correct usage.",
      },
    }));
    mockFetch({
      "GET /api/collections": { collections: [], memberships: [], owner: false },
      "POST /api/practice/next": NEXT_PAYLOAD,
      "POST /api/practice/score": scoreMock,
      "POST /api/practice/result": { from: "recall", stage: "production" },
    });

    renderWithSWR(<PracticePage />);

    // The prompt for the picked word renders once /next resolves.
    await screen.findByText("reluctant");
    const button = await screen.findByRole("button", { name: "Check my answer" });

    // Type an answer, then check it.
    const textarea = screen.getByPlaceholderText("Write in English…");
    fireEvent.change(textarea, {
      target: { value: "She was reluctant to leave." },
    });
    fireEvent.click(button);

    // The <Feedback> block must render the verdict heading + the score.
    await waitFor(() => {
      expect(screen.getByText(/Correct/)).toBeTruthy();
    });
    // The score is rendered as "· 95/100" next to the heading.
    expect(screen.getByText(/95\/100/)).toBeTruthy();
    expect(screen.getByText("Natural and correct usage.")).toBeTruthy();
    // The scorer was actually called with the typed answer.
    expect(scoreMock).toHaveBeenCalledTimes(1);
  });
});
