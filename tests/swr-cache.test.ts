import { describe, it, expect } from "vitest";
import type { Collection, WordListItem } from "@/lib/types";
import {
  WORDS_PAGE_SIZE,
  wordsPageKey,
  wordsPageGetKey,
  markStudyingInPages,
  membershipReducer,
  type WordsPage,
  type CollectionsData,
} from "@/lib/swr-cache";

/*
 * QW1 — unit tests for the pure Library SWR cache reducers. These are the
 * functions the "+ Add reappears" bug (PR #41) lived next to; they were
 * untestable while they sat inside the `"use client"` lib/swr.ts (which imports
 * swr/infinite). Extracted to lib/swr-cache.ts, they're now covered here in ~a
 * few assertions — the class this suite exists to catch.
 */

function item(id: string, studying = true): WordListItem {
  return {
    id,
    word: `w-${id}`,
    ipa: "",
    vi_meaning: "",
    tags: [],
    stage: "new",
    times_seen: 0,
    recent_results: [],
    created_at: 0,
    studying,
  };
}
function page(words: WordListItem[], total: number, offset = 0): WordsPage {
  return { words, total, limit: WORDS_PAGE_SIZE, offset };
}

describe("wordsPageKey", () => {
  it("omits q, stage='all' and empty collection so keys stay stable", () => {
    expect(wordsPageKey({ q: "", stage: "all", collection: "" }, 0)).toBe(
      "/api/words?fields=list&limit=20&offset=0",
    );
  });

  it("includes each set filter and the offset", () => {
    expect(
      wordsPageKey({ q: "cat", stage: "recall", collection: "c1" }, 40),
    ).toBe(
      "/api/words?fields=list&limit=20&offset=40&q=cat&stage=recall&collection=c1",
    );
  });

  it("trims the query and drops it when blank", () => {
    expect(wordsPageKey({ q: "  spaced  " }, 0)).toBe(
      "/api/words?fields=list&limit=20&offset=0&q=spaced",
    );
    expect(wordsPageKey({ q: "   " }, 0)).toBe(
      "/api/words?fields=list&limit=20&offset=0",
    );
  });
});

describe("wordsPageGetKey (useSWRInfinite stop-condition)", () => {
  const filter = { collection: "c1" };

  it("returns the first page key when there is no previous page", () => {
    expect(wordsPageGetKey(filter, 0, null)).toBe(wordsPageKey(filter, 0));
  });

  it("stops paging when the previous page was short (last page)", () => {
    const short = page([item("a")], 1); // fewer than a full page
    expect(wordsPageGetKey(filter, 1, short)).toBeNull();
  });

  it("stops paging once the offset has covered the reported total", () => {
    const full = page(Array.from({ length: WORDS_PAGE_SIZE }, (_, i) => item(String(i))), WORDS_PAGE_SIZE);
    // index 1 -> offset 20 >= total 20 -> stop
    expect(wordsPageGetKey(filter, 1, full)).toBeNull();
  });

  it("returns the next page key while more pages remain", () => {
    const full = page(Array.from({ length: WORDS_PAGE_SIZE }, (_, i) => item(String(i))), 50);
    expect(wordsPageGetKey(filter, 1, full)).toBe(wordsPageKey(filter, WORDS_PAGE_SIZE));
  });
});

describe("markStudyingInPages", () => {
  it("flips exactly the adopted ids across ALL loaded pages and touches nothing else", () => {
    const pages = [
      page([item("a", false), item("b", true)], 4, 0),
      page([item("c", false), item("d", false)], 4, 20),
    ];
    const out = markStudyingInPages(pages, new Set(["a", "c"]))!;
    expect(out[0].words.map((w) => [w.id, w.studying])).toEqual([
      ["a", true],
      ["b", true],
    ]);
    expect(out[1].words.map((w) => [w.id, w.studying])).toEqual([
      ["c", true],
      ["d", false], // untouched
    ]);
  });

  it("returns pages structurally new (immutable update) but preserves paging fields", () => {
    const pages = [page([item("a", false)], 1, 0)];
    const out = markStudyingInPages(pages, new Set(["a"]))!;
    expect(out).not.toBe(pages);
    expect(out[0]).not.toBe(pages[0]);
    expect(out[0].total).toBe(1);
    expect(out[0].offset).toBe(0);
    // original untouched
    expect(pages[0].words[0].studying).toBe(false);
  });

  it("is a no-op for an empty id set or missing pages", () => {
    const pages = [page([item("a", false)], 1)];
    expect(markStudyingInPages(pages, new Set())).toBe(pages);
    expect(markStudyingInPages(undefined, new Set(["a"]))).toBeUndefined();
  });
});

describe("membershipReducer", () => {
  function data(): CollectionsData {
    const collections: Collection[] = [
      { id: "c1", name: "One", count: 2 } as Collection,
      { id: "c2", name: "Two", count: 0 } as Collection,
    ];
    return {
      collections,
      memberships: [{ word_id: "w1", collection_id: "c1" }],
      owner: false,
    };
  }

  it("adds a membership and bumps the collection count when turned on", () => {
    const out = membershipReducer(data(), "w2", "c2", true)!;
    expect(out.memberships).toContainEqual({ word_id: "w2", collection_id: "c2" });
    expect(out.collections.find((c) => c.id === "c2")!.count).toBe(1);
  });

  it("removes a membership and decrements the count when turned off", () => {
    const out = membershipReducer(data(), "w1", "c1", false)!;
    expect(out.memberships).not.toContainEqual({ word_id: "w1", collection_id: "c1" });
    expect(out.collections.find((c) => c.id === "c1")!.count).toBe(1);
  });

  it("returns prev unchanged when already in the desired state", () => {
    const d = data();
    expect(membershipReducer(d, "w1", "c1", true)).toBe(d); // already a member
    expect(membershipReducer(d, "w9", "c1", false)).toBe(d); // already absent
  });

  it("never drives a count below zero", () => {
    const d = data(); // c2 starts at count 0 with no members
    d.memberships.push({ word_id: "wx", collection_id: "c2" });
    const out = membershipReducer(d, "wx", "c2", false)!;
    expect(out.collections.find((c) => c.id === "c2")!.count).toBe(0);
  });

  it("passes through an undefined cache", () => {
    expect(membershipReducer(undefined, "w1", "c1", true)).toBeUndefined();
  });
});
