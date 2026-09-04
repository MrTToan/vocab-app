"use client";

import useSWR, { mutate, type SWRConfiguration } from "swr";
import useSWRInfinite, {
  type SWRInfiniteConfiguration,
} from "swr/infinite";
import type { Word, WordListItem } from "./types";
import type { ClassDetail, MyClassesData, PendingInvite } from "./classes/types";
import type {
  AssignmentDetail,
  ClassAssignments,
  KindTab,
  PickableContent,
  StudentAssignment,
} from "./assignments/types";
import type { StudentReportPayload } from "./report";
import { jsonFetch } from "./ui";
import {
  WORDS_LIST_BASE,
  WORDS_PAGE_SIZE,
  wordsPageKey,
  wordsPageGetKey,
  markStudyingInPages,
  membershipReducer,
  collectionReducer,
  type WordsFilter,
  type WordsPage,
  type Membership,
  type CollectionsData,
} from "./swr-cache";

// Re-export the hook-free cache core so existing `@/lib/swr` importers keep
// working; the pure pieces themselves live in (and are unit-tested from)
// `lib/swr-cache.ts`.
export {
  WORDS_LIST_BASE,
  WORDS_PAGE_SIZE,
  wordsPageKey,
  markStudyingInPages,
  collectionReducer,
};
export type { WordsFilter, WordsPage, Membership, CollectionsData };

/**
 * Shared SWR layer — one typed fetcher + one cache key per endpoint so every page
 * shows cached data instantly and revalidates in the background, and shared data
 * (the collections list, the stats summary) is fetched once and deduped across
 * pages. On every write the caller must revalidate the affected key(s) via the
 * mutate helpers below so the UI never shows stale data after a change.
 */

/** Typed GET fetcher used by every hook. Errors bubble as thrown Errors. */
export const fetcher = <T>(url: string): Promise<T> => jsonFetch<T>(url);

/** @deprecated superseded by the paginated `useWordsPage`; kept for the prefix. */
export const KEY_WORDS_LIST = WORDS_LIST_BASE;
export const KEY_COLLECTIONS = "/api/collections";
export const KEY_STATS = "/api/stats";
export const KEY_CONFIG = "/api/config";
export const KEY_WRITING_STATS = "/api/writing/stats";
/** The classes hub (teaching + enrolled). Every class key lives under this
 *  prefix so `revalidateClasses()` matches the hub, detail and roster at once. */
export const KEY_CLASSES = "/api/classes";

/** Pending email invites addressed to the caller (route 11 → the hub banner).
 *  Under the KEY_CLASSES prefix so `revalidateClasses()` refreshes it after an
 *  accept/decline/create/revoke. */
export const KEY_INVITES = "/api/classes/invites";

/** Per-word full-detail key (lazy editor load after the slim list). */
export const wordKey = (id: string) => `/api/words/${id}`;

/** One class's detail (teacher roster / student trust view). */
export const classKey = (id: string) => `/api/classes/${id}`;

/** A teacher's read-only report for one student (route 17). Under the
 *  KEY_CLASSES prefix so `revalidateClasses()` clears it when the roster changes
 *  (e.g. the student is removed → their next report fetch 404s). */
export const studentReportKey = (classId: string, studentId: string) =>
  `/api/classes/${classId}/students/${studentId}/report`;

/** Writing question list for one task tab (task1 | task2). */
export const writingPromptsKey = (task: string) => `/api/writing/prompts?task=${task}`;

/** The caller's own assignments across every class (the /classes hub roll-up). */
export const KEY_MY_ASSIGNMENTS = "/api/assignments";
/** The registry's picker kinds (tab strip). */
export const KEY_ASSIGNMENT_KINDS = "/api/assignments/kinds";
/** One class's assignments (teacher list / student list). Lives under KEY_CLASSES
 *  so a roster change also refreshes it via revalidateClasses(). */
export const classAssignmentsKey = (classId: string) => `/api/classes/${classId}/assignments`;
/** One assignment's detail (teacher grid / student card). */
export const assignmentKey = (id: string) => `/api/assignments/${id}`;
/** The teacher's content picker for one kind + search. */
export const assignmentContentKey = (kind: string, q: string) =>
  `/api/assignments/content?kind=${encodeURIComponent(kind)}&q=${encodeURIComponent(q)}`;

/** What /api/config returns. Diagnostic fields are owner-only (may be absent). */
export type ConfigData = {
  hasLLM: boolean;
  owner: boolean;
  backend?: string;
  mode?: string;
  active?: number;
  chain?: Array<{ provider: string; model: string }>;
};

/* ─────────────────────────────  Hooks  ───────────────────────────── */

export function useWordsList(config?: SWRConfiguration) {
  return useSWR<{ words: WordListItem[] }>(KEY_WORDS_LIST, fetcher, config);
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
    (index, prev) => wordsPageGetKey(filter, index, prev),
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

/** The classes hub — the caller's teaching + enrolled classes. */
export function useMyClasses(config?: SWRConfiguration) {
  return useSWR<MyClassesData>(KEY_CLASSES, fetcher, config);
}

/** One class's detail (pass a falsy id to skip). */
export function useClass(id: string | null | undefined, config?: SWRConfiguration) {
  return useSWR<ClassDetail>(id ? classKey(id) : null, fetcher, config);
}

/** Pending email invites addressed to the caller (the hub banner). */
export function useMyInvites(config?: SWRConfiguration) {
  return useSWR<{ invites: PendingInvite[] }>(KEY_INVITES, fetcher, config);
}

/** A teacher's read-only report for one student (route 17). Pass falsy ids to
 *  skip. A non-teacher / wrong-teacher fetch 404s (surfaced as an SWR error). */
export function useStudentReport(
  classId: string | null | undefined,
  studentId: string | null | undefined,
  config?: SWRConfiguration,
) {
  return useSWR<StudentReportPayload>(
    classId && studentId ? studentReportKey(classId, studentId) : null,
    fetcher,
    config,
  );
}

/**
 * Writing question list for a task, cached per task key. `P` is the caller's
 * prompt row shape (the writing components decorate summaries with stats).
 */
export function useWritingPrompts<P>(task: string, config?: SWRConfiguration) {
  return useSWR<{ prompts: P[] }>(writingPromptsKey(task), fetcher, config);
}

/** The caller's own assignments across every class (the hub roll-up). */
export function useMyAssignments(config?: SWRConfiguration) {
  return useSWR<{ assignments: StudentAssignment[] }>(KEY_MY_ASSIGNMENTS, fetcher, config);
}

/** One class's assignments, role-shaped (pass a falsy id to skip). */
export function useClassAssignments(id: string | null | undefined, config?: SWRConfiguration) {
  return useSWR<ClassAssignments>(id ? classAssignmentsKey(id) : null, fetcher, config);
}

/** One assignment's detail, role-shaped (pass a falsy id to skip). */
export function useAssignment(id: string | null | undefined, config?: SWRConfiguration) {
  return useSWR<AssignmentDetail>(id ? assignmentKey(id) : null, fetcher, config);
}

/** The teacher's content picker for one kind + search (skip when kind is falsy). */
export function useAssignableContent(
  kind: string | null | undefined,
  q: string,
  config?: SWRConfiguration,
) {
  return useSWR<{ content: PickableContent[] }>(
    kind ? assignmentContentKey(kind, q) : null,
    fetcher,
    config,
  );
}

/** The picker's kind tabs (registry-driven). */
export function useAssignmentKinds(config?: SWRConfiguration) {
  return useSWR<{ kinds: KindTab[] }>(KEY_ASSIGNMENT_KINDS, fetcher, config);
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
/**
 * A class was created / joined / left / renamed / archived, its roster or join
 * code changed, or an invite was created / revoked / accepted / declined. Match
 * every class key by PREFIX (the hub, each detail, each roster, the invite
 * banner) so nothing is left stale after a write — keep new class keys under
 * KEY_CLASSES.
 */
export function revalidateClasses() {
  return mutate((key) => typeof key === "string" && key.startsWith(KEY_CLASSES));
}
/** A writing prompt was added or a submission scored — refetch that task's list. */
export function revalidateWritingPrompts(task: string) {
  return mutate(writingPromptsKey(task));
}

/**
 * An assignment was created / edited / archived, or its completion may have moved
 * (a student practised). Matches every assignment key — the hub roll-up
 * (`/api/assignments…`) AND a class's assignment list (`/api/classes/<id>/assignments`)
 * AND a detail — by the shared `/assignments` fragment.
 */
export function revalidateAssignments() {
  return mutate((key) => typeof key === "string" && key.includes("/assignments"));
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
 * again with `!on` to revert if the persist fails. The pure transform lives in
 * `membershipReducer` (`lib/swr-cache.ts`) so it can be unit-tested.
 */
export function applyMembershipToCache(
  wordId: string,
  collectionId: string,
  on: boolean,
) {
  return mutate<CollectionsData>(
    KEY_COLLECTIONS,
    (prev) => membershipReducer(prev, wordId, collectionId, on),
    { revalidate: false },
  );
}
