import type { Collection, WordListItem } from "./types";

/**
 * Hook-free, node-importable core of the Library SWR cache: the list key
 * builders, the `useWordsPage` getKey stop-condition, and the PURE cache
 * reducers (`markStudyingInPages`, `membershipReducer`). `lib/swr.ts` is
 * `"use client"` and imports `swr/infinite`, so it can't load under vitest's
 * node environment — these pieces live here so they can be unit-tested directly
 * (they'd have caught the "+ Add reappears" cache-desync bug, PR #41's class).
 *
 * Keep this module free of React/SWR imports so it stays importable in node.
 */

/** Prefix shared by every Library list page key. `revalidateWords()` matches on
 *  it so ONE call refreshes every cached filter/offset page after a write. */
export const WORDS_LIST_BASE = "/api/words?fields=list";

/** Rows per page; the "Show more" button loads one more of these. */
export const WORDS_PAGE_SIZE = 20;

/** How the Library list is filtered — mirrors the store's ListPageOpts (server-side). */
export type WordsFilter = { q?: string; stage?: string; collection?: string };

/** One server page (rows). Matches the store's ListPage + the echoed paging. */
export type WordsPage = {
  words: WordListItem[];
  total: number;
  limit: number;
  offset: number;
};

export type Membership = { word_id: string; collection_id: string };
export type CollectionsData = {
  collections: Collection[];
  memberships: Membership[];
  owner: boolean;
};

/** Build the list key for one filter + offset. `q`/`stage:"all"`/empty
 *  collection are omitted so their keys stay stable. */
export function wordsPageKey(filter: WordsFilter, offset: number): string {
  const p = new URLSearchParams({
    fields: "list",
    limit: String(WORDS_PAGE_SIZE),
    offset: String(offset),
  });
  const q = filter.q?.trim();
  if (q) p.set("q", q);
  if (filter.stage && filter.stage !== "all") p.set("stage", filter.stage);
  if (filter.collection) p.set("collection", filter.collection);
  return `/api/words?${p.toString()}`;
}

/**
 * The `useSWRInfinite` getKey: the key for page `index`, or `null` to stop
 * paging. Stops when the previous page was short (last page) or once the offset
 * has already covered the reported `total`. Pure so the stop-condition can be
 * unit-tested without mounting the hook.
 */
export function wordsPageGetKey(
  filter: WordsFilter,
  index: number,
  prev: WordsPage | null,
): string | null {
  if (prev && prev.words.length < WORDS_PAGE_SIZE) return null;
  if (prev && index * WORDS_PAGE_SIZE >= prev.total) return null;
  return wordsPageKey(filter, index * WORDS_PAGE_SIZE);
}

/**
 * One or more not-yet-studied members were adopted from the collection filter —
 * flip their `studying` flag to true across the LOADED list pages WITHOUT a
 * refetch (so each row stays put, now studied, and its "+ Add" disappears).
 *
 * Pure pages-updater for the BOUND `mutate` returned by `useWordsPage`
 * (useSWRInfinite). A global `mutate` matcher over the child page keys does NOT
 * reliably re-render the infinite hook, so the optimistic flip was lost and the
 * button reappeared — the bound mutate is the correct lever. Pair the call with
 * `revalidateStats()` (studied/stage counts changed).
 */
export function markStudyingInPages(
  pages: WordsPage[] | undefined,
  ids: ReadonlySet<string>,
): WordsPage[] | undefined {
  if (!pages || ids.size === 0) return pages;
  return pages.map((page) => ({
    ...page,
    words: page.words.map((w) =>
      ids.has(w.id) ? { ...w, studying: true } : w,
    ),
  }));
}

/**
 * Pure reducer for the optimistic membership toggle: flip one
 * word↔collection membership in a `CollectionsData` snapshot (and keep the
 * collection's `count` chip honest) WITHOUT a refetch. `applyMembershipToCache`
 * feeds this to SWR's `mutate`; keeping the transform pure lets it be
 * unit-tested. Returns `prev` unchanged when already in the desired state.
 */
export function membershipReducer(
  prev: CollectionsData | undefined,
  wordId: string,
  collectionId: string,
  on: boolean,
): CollectionsData | undefined {
  if (!prev) return prev;
  const exists = prev.memberships.some(
    (m) => m.word_id === wordId && m.collection_id === collectionId,
  );
  if (on === exists) return prev; // already in the desired state
  const memberships = on
    ? [...prev.memberships, { word_id: wordId, collection_id: collectionId }]
    : prev.memberships.filter(
        (m) => !(m.word_id === wordId && m.collection_id === collectionId),
      );
  const collections = prev.collections.map((c) =>
    c.id === collectionId
      ? { ...c, count: Math.max(0, (c.count ?? 0) + (on ? 1 : -1)) }
      : c,
  );
  return { ...prev, memberships, collections };
}
