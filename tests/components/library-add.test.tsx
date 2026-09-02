import { describe, it, expect, afterEach, vi } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import type { WordListItem } from "@/lib/types";
import { mockFetch, renderWithSWR } from "./harness";
import LibraryPage from "@/app/(app)/library/page";

/*
 * REGRESSION for 2.3 — Library "+ Add" didn't clear after adopting a word.
 * The adopt POST always succeeded; the bug was the CLIENT SWR cache failing to
 * reflect it — a global `mutate` matcher over the useSWRInfinite page keys
 * didn't re-render the hook, so the optimistic `studying:true` flip was lost and
 * the "+ Add" button reappeared. The fix uses the BOUND mutate from
 * useWordsPage. This drives the real page: click "+ Add" → the button
 * disappears AND stays gone after the mutation settles.
 *
 * Complements the pure reducer test (lib/swr-cache: markStudyingInPages) with
 * the end-to-end wiring the reducer alone can't prove.
 */

const NOT_STUDIED: WordListItem = {
  id: "w1",
  word: "reluctant",
  ipa: "/rɪˈlʌktənt/",
  vi_meaning: "miễn cưỡng",
  tags: [],
  stage: "new",
  times_seen: 0,
  recent_results: [],
  created_at: Date.now(),
  studying: false, // a collection member the user does not study yet → "+ Add"
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("LibraryPage — '+ Add' disappears and does not reappear after adopt", () => {
  it("flips the row to studying via the bound cache and the button stays gone", async () => {
    const adopt = vi.fn(() => ({ ok: true }));
    mockFetch({
      "GET /api/collections": {
        collections: [{ id: "c1", name: "Pack", emoji: "", count: 1 }],
        memberships: [{ word_id: "w1", collection_id: "c1" }],
        owner: false,
      },
      "GET /api/words": { words: [NOT_STUDIED], total: 1, limit: 20, offset: 0 },
      "POST /api/words/w1/adopt": adopt,
      "GET /api/stats": {},
    });

    renderWithSWR(<LibraryPage />);

    // The not-yet-studied row renders with a "+ Add" button.
    const addBtn = await screen.findByRole("button", {
      name: /Add reluctant to my studying/,
    });
    expect(addBtn).toBeTruthy();

    fireEvent.click(addBtn);

    // Optimistic flip: the button must disappear...
    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: /Add reluctant to my studying/ }),
      ).toBeNull();
    });

    // ...the adopt POST fired...
    await waitFor(() => expect(adopt).toHaveBeenCalledTimes(1));

    // ...and it must NOT reappear once everything settles (the old bug).
    await new Promise((r) => setTimeout(r, 20));
    expect(
      screen.queryByRole("button", { name: /Add reluctant to my studying/ }),
    ).toBeNull();
    // The word itself is still listed (now studied), just without "+ Add".
    expect(screen.getByText("reluctant")).toBeTruthy();
  });
});
