/*
 * The AssignableKind adapter interface — the spine of the assignments feature.
 *
 * Everything a content KIND needs in order to be assignable lives behind this one
 * interface: how to (a) list/select it for the teacher's picker, (b) resolve a ref
 * into a display card that deep-links into the EXISTING doing-flow, and (c) measure
 * a student's completion. A new kind (writing prompt, grammar drill, listening set)
 * is added by implementing this interface + registering it in ./index.ts + adding
 * the string to ASSIGNMENT_KINDS — with NO database or shared-UI change. The client
 * never switches on kind; it only renders the ContentCard/AssignmentProgress a kind
 * produces.
 */

import type {
  AssignmentKind,
  AssignmentProgress,
  ContentCard,
  PickableContent,
} from "../types";

export interface AssignableKind {
  /** The registry key, e.g. "vocab_collection". */
  kind: AssignmentKind;
  /** Human label + emoji for the picker tab. */
  label: string;
  emoji: string;

  /** (a) SELECT — content of this kind visible to `userId`, filtered by `q`,
   *  as pickable summaries for the teacher's "New assignment" picker. */
  listPickable(userId: string, q: string): Promise<PickableContent[]>;

  /** Validate a ref when an assignment is created: it must exist AND be assignable
   *  (visible to the teacher). `{ ok:false, reason }` becomes a 400 with the reason. */
  validateRef(ref: string, teacherId: string): Promise<{ ok: boolean; reason?: string }>;

  /** Resolve a ref into a display card (with `doHref` into the existing flow).
   *  `available:false` when the content was deleted / is gone. AUTHORIZATION IS THE
   *  CALLER'S JOB — the store only calls this for refs the viewer may see (their
   *  own/public content, or an assignment they are a confirmed target of). */
  resolveCard(ref: string): Promise<ContentCard>;

  /** (c) MEASURE — the kind's default completion rule, and a student's progress
   *  against a ref (single + batched, the batched form avoids N+1 on the grid).
   *  `assignedAt` bounds what counts: ONLY practice/work done at or after the
   *  moment THAT student was assigned (their `assignment_targets.created_at`,
   *  falling back to the assignment's `created_at`) may count toward completion —
   *  prior history never pre-credits a new assignment. The batched form takes a
   *  per-student map so students assigned at different times grade correctly. */
  defaultCriteria(): Record<string, unknown>;
  progressFor(
    studentId: string,
    ref: string,
    criteria: Record<string, unknown>,
    assignedAt: number,
  ): Promise<AssignmentProgress>;
  progressForMany(
    studentIds: string[],
    ref: string,
    criteria: Record<string, unknown>,
    assignedAt: Record<string, number>,
  ): Promise<Record<string, AssignmentProgress>>;
}
