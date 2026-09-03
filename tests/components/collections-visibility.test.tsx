import { describe, it, expect, afterEach, vi } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import type { Collection } from "@/lib/types";
import { mockFetch, renderWithSWR, type MatchedRequest } from "./harness";
import Collections from "@/components/vocab/Collections";

/*
 * REGRESSION — the "Make public" / "Make private" toggle on /vocab did nothing.
 *
 * The PATCH always succeeded server-side (visibility flipped, owner_id moved to
 * __system__ for public). The bug was CLIENT-side: the handler only called
 * `revalidateCollections()` (a refetch), but `/api/collections` ships
 * `Cache-Control: max-age=30`, so within 30s the browser served the refetch
 * STALE from its HTTP cache — the UI never saw the change and the click "did
 * nothing" until the cache expired. The fix patches the server-confirmed row
 * into the SWR cache in place (bound mutate + collectionReducer), like the
 * writing side's patchWritingPromptsCache.
 *
 * This test models the stale cache by having the GET stub ALWAYS return the
 * pre-toggle (private) list, while the PATCH returns the confirmed (public) row.
 * A refetch-only handler therefore stays "Make public"; the fix flips to
 * "Make private" from the PATCH response without trusting the refetch.
 */

const PRIVATE: Collection = {
  id: "c1",
  name: "IELTS Task 1",
  description: "",
  emoji: "📈",
  created_at: 1,
  owner_id: "local-user",
  visibility: "private",
  count: 3,
  mine: true,
};

// What the server returns from the PATCH after persisting the flip to public.
const PUBLIC: Collection = {
  ...PRIVATE,
  owner_id: "__system__",
  visibility: "public",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Collections — visibility toggle flips even when the refetch is stale", () => {
  it("shows 'Make private' + Public chip from the PATCH response, not a stale refetch", async () => {
    const patch = vi.fn((_req: MatchedRequest) => ({ collection: PUBLIC }));
    mockFetch({
      // The GET always returns the STALE (private) list — this is the browser
      // micro-cache serving max-age=30 content to any revalidation.
      "GET /api/collections": {
        collections: [PRIVATE],
        memberships: [],
        owner: true,
      },
      "PATCH /api/collections/c1": patch,
    });

    renderWithSWR(<Collections />);

    // The owned private collection renders with a "Make public" button.
    const makePublic = await screen.findByRole("button", { name: "Make public" });
    expect(makePublic).toBeTruthy();

    fireEvent.click(makePublic);

    // The PATCH fired with the public visibility.
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect(patch.mock.calls[0][0].body).toEqual({ visibility: "public" });

    // The row must reflect the flip: button becomes "Make private" and the
    // "Public" chip appears — from the PATCH response, despite the stale GET.
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Make private" })).toBeTruthy();
    });
    expect(screen.getByText("Public")).toBeTruthy();
    // And it must NOT snap back once everything settles (a stale refetch would
    // overwrite the flip).
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByRole("button", { name: "Make private" })).toBeTruthy();
  });
});
