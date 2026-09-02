import { describe, it, expect, afterEach, vi } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { mockFetch, renderWithSWR } from "./harness";
import AddWord from "@/components/vocab/AddWord";

/*
 * Seed coverage for the third stateful client entry point (2.4 / MI1): the
 * single-word Add flow. Drives the no-LLM manual path — enter a word → "Fill
 * in →" → review → fill the meaning → "Save word" → assert the POST fires with
 * the typed data and the "Saved …" confirmation renders. Guards the input →
 * review → save state machine that no route test can see.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AddWord — manual add flow (no LLM)", () => {
  it("saves a manually-entered word and confirms it", async () => {
    const post = vi.fn((req) => ({ word: { id: "w-new", ...(req.body as object) } }));
    mockFetch({
      "GET /api/config": { hasLLM: false },
      "GET /api/collections": { collections: [], memberships: [], owner: false },
      "GET /api/words/check": { exists: false },
      "POST /api/words": post,
      "GET /api/stats": {},
    });

    renderWithSWR(<AddWord />);

    // Enter the word — with no LLM key the CTA is "Fill in →".
    fireEvent.change(screen.getByPlaceholderText("e.g. reluctant"), {
      target: { value: "serendipity" },
    });
    fireEvent.click(await screen.findByRole("button", { name: "Fill in →" }));

    // Review phase: fill the Vietnamese meaning, then save.
    const meaning = await screen.findByLabelText("Vietnamese meaning");
    fireEvent.change(meaning, { target: { value: "sự tình cờ may mắn" } });
    fireEvent.click(screen.getByRole("button", { name: "Save word" }));

    // The confirmation renders and the POST carried the typed fields.
    await waitFor(() => {
      expect(screen.getByText(/Saved “serendipity”/)).toBeTruthy();
    });
    expect(post).toHaveBeenCalledTimes(1);
    const body = post.mock.calls[0][0].body as {
      word: string;
      vi_meaning: string;
      source: string;
    };
    expect(body.word).toBe("serendipity");
    expect(body.vi_meaning).toBe("sự tình cờ may mắn");
    expect(body.source).toBe("manual");
  });
});
