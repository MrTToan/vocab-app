"use client";

import useSWR, { mutate, type SWRConfiguration } from "swr";
import useSWRInfinite, {
  type SWRInfiniteConfiguration,
} from "swr/infinite";
import type { Collection, Word, WordListItem } from "./types";
import { jsonFetch } from "./ui";

/**
 * Shared SWR layer — one typed fetcher + one cache key per endpoint so every page
 * shows cached data instantly and revalidates in the background, and shared data
 * (the collections list, the stats summary) is fetched once and deduped across
 * pages. On every write the caller must revalidate the affected key(s) via the
 * mutate helpers below so the UI never shows stale data after a change.
 */

/** Typed GET fetcher used by every hook. Errors bubble as thrown Errors. */
export const fetcher = <T>(url: string): Promise<T> => jsonFetch<T>(url);

/** Prefix shared by every Library list page key. `revalidateWords()` matches on
 *  it so ONE call refreshes every cached filter/offset page after a write. */
export const WORDS_LIST_BASE = "/api/words?fields=list";
/** @deprecated superseded by the paginated `useWordsPage`; kept for the prefix. */
export const KEY_WORDS_LIST = WORDS_LIST_BASE;
export const KEY_COLLECTIONS = "/api/collections";
export const KEY_STATS = "/api/stats";
export const KEY_CONFIG = "/api/config";
export const KEY_WRITING_STATS = "/api/writing/stats";

/** Per-word full-detail key (lazy editor load after the slim list). */
export const wordKey = (id: string) => `/api/words/${id}`;

/** Writing question list for one task tab (task1 | task2). */
export const writingPromptsKey = (task: string) => `/api/writing/prompts?task=${task}`;

/** What /api/config returns. Diagnostic fields are owner-only (may be absent). */
export type ConfigData = {
  hasLLM: boolean;
  owner: boolean;
  backend?: string;
  mode?: string;
  active?: number;
  chain?: Array<{ provider: string; model: string }>;
};

export type Membership = { word_id: string; collection_id: string };
export type CollectionsData = {
  collections: Collection[];
  memberships: Membership[];
  owner: boolean;
};

/* ─────────────────────────────  Hooks  ───────────────────────────── */

export function useWordsList(config?: SWRConfiguration) {
  return useSWR<{ words: WordListItem[] }>(KEY_WORDS_LIST, fetcher, config);
}

/** How the Library list is filtered — mirrors the store's ListPageOpts (server-side). */
export type WordsFilter = { q?: string; stage?: string; collection?: string };
/** One server page (rows). Matches the store's ListPage + the echoed paging. */
export type WordsPage = {
  words: WordListItem[];
  total: number;
  limit: number;
  offset: number;
};
/** Rows per page; the "Show more" button loads one more of these. */
export const WORDS_PAGE_SIZE = 20;

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
 * Paginated Library list. Each page is fetched from the server (a page is a
 * page — never the whole ~1,200-row list); `setSize` loads one more. Filtering
 * (search / stage / collection) is server-side so pages compose and page
 * correctly. Reads `data` as an array of pages: flatten `.words`, and take
 * `total` from the first page.
 */
export function useWordsPage(
  filter: WordsFilter,
  config?: SWRInfiniteConfiguration,
) {
  return useSWRInfinite<WordsPage>(
    (index, prev) => {
      // Stop when the last page was short, or we've already covered the total.
      if (prev && prev.words.length < WORDS_PAGE_SIZE) return null;
      if (prev && index * WORDS_PAGE_SIZE >= prev.total) return null;
      return wordsPageKey(filter, index * WORDS_PAGE_SIZE);
    },
    fetcher,
    config,
  );
}

export function useCollections(config?: SWRConfiguration) {
  return useSWR<CollectionsData>(KEY_COLLECTIONS, fetcher, config);
}

/** Full word, fetched on demand (pass a falsy id to skip the request). */
export function useWord(id: string | null | undefined) {
  return useSWR<{ word: Word }>(id ? wordKey(id) : null, fetcher);
}

/** Runtime config (hasLLM / owner) — fetched once and deduped across pages. */
export function useConfig(config?: SWRConfiguration) {
  return useSWR<ConfigData>(KEY_CONFIG, fetcher, config);
}

/**
 * Writing question list for a task, cached per task key. `P` is the caller's
 * prompt row shape (the writing components decorate summaries with stats).
 */
export function useWritingPrompts<P>(task: string, config?: SWRConfiguration) {
  return useSWR<{ prompts: P[] }>(writingPromptsKey(task), fetcher, config);
}

/* ───────────────────────────  Mutations  ─────────────────────────── */

export function revalidateWords() {
  // Match every cached list page (all filters/offsets), not just the base key —
  // the Library now fetches parameterized pages via useWordsPage.
  return mutate(
    (key) => typeof key === "string" && key.startsWith(WORDS_LIST_BASE),
  );
}
export function revalidateCollections() {
  return mutate(KEY_COLLECTIONS);
}
export function revalidateStats() {
  return mutate(KEY_STATS);
}
/** A writing prompt was added or a submission scored — refetch that task's list. */
export function revalidateWritingPrompts(task: string) {
  return mutate(writingPromptsKey(task));
}

/**
 * Patch one task's cached writing-prompt list in place WITHOUT a refetch — for
 * server-confirmed local changes (visibility toggled, prompt deleted), same
 * pattern as `applyMembershipToCache`.
 */
export function patchWritingPromptsCache<P>(task: string, patch: (prompts: P[]) => P[]) {
  return mutate<{ prompts: P[] }>(
    writingPromptsKey(task),
    (prev) => (prev ? { prompts: patch(prev.prompts) } : prev),
    { revalidate: false },
  );
}

/**
 * A word was added / edited / deleted / had its progress reset — refresh the
 * Library list and the aggregate stats. Collection counts can also change (a
 * deleted word leaves its collections), so refresh those too.
 */
export function mutateAfterWordChange() {
  return Promise.all([
    revalidateWords(),
    revalidateStats(),
    revalidateCollections(),
  ]);
}

/**
 * A not-yet-studied word was adopted from the collection filter — flip its
 * `studying` flag to true across every cached list page WITHOUT a refetch (so
 * the row stays put, now studied). Pair with `revalidateStats()` because the
 * user's studied/stage counts changed. Composes with `revalidateWords()`.
 */
export function applyWordAdoptedToCache(wordId: string) {
  return mutate<WordsPage>(
    (key) => typeof key === "string" && key.startsWith(WORDS_LIST_BASE),
    (page) =>
      page
        ? {
            ...page,
            words: page.words.map((w) =>
              w.id === wordId ? { ...w, studying: true } : w,
            ),
          }
        : page,
    { revalidate: false },
  );
}

/**
 * Optimistically flip one word↔collection membership in the collections cache
 * (and keep the collection's `count` chip honest) WITHOUT a refetch — this is
 * what makes the Library chip toggle feel instant (composes with PR #11). Call
 * again with `!on` to revert if the persist fails.
 */
export function applyMembershipToCache(
  wordId: string,
  collectionId: string,
  on: boolean,
) {
  return mutate<CollectionsData>(
    KEY_COLLECTIONS,
    (prev) => {
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
    },
    { revalidate: false },
  );
}
