/*
 * The kind registry — the ONE place assignment kinds are enumerated at runtime.
 * Adding a kind = implement AssignableKind + add one line here + add the string to
 * ASSIGNMENT_KINDS (lib/assignments/types.ts). No schema, route, or shared-UI change.
 */

import type { AssignmentKind, KindTab } from "../types";
import type { AssignableKind } from "./kind";
import { vocabCollectionKind } from "./vocab";

export type { AssignableKind } from "./kind";

export const KINDS: Record<AssignmentKind, AssignableKind> = {
  vocab_collection: vocabCollectionKind,
  // Slice 2 drops in: writing_prompt: writingPromptKind,
};

/** The adapter for a kind string, or undefined for an unknown kind. */
export function kindFor(k: string): AssignableKind | undefined {
  return (KINDS as Record<string, AssignableKind>)[k];
}

/** Picker tabs, registry-driven (GET /api/assignments/kinds). */
export function kindTabs(): KindTab[] {
  return Object.values(KINDS).map((k) => ({ kind: k.kind, label: k.label, emoji: k.emoji }));
}
