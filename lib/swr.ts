"use client";

import useSWR, { mutate, type SWRConfiguration } from "swr";
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

export const KEY_WORDS_LIST = "/api/words?fields=list";
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
  return mutate(KEY_WORDS_LIST);
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
