/*
 * Shared assignment types. Imported by the zod schemas (lib/api-schemas.ts), the
 * store + kind adapters (server) AND the client pages/components + lib/swr.ts, so
 * the layers can never drift. Must stay free of any server-only import so the
 * client can import the shapes.
 *
 * The spine (captain's top priority): an assignment names its content by
 * (kind, ref) — a registry key + the stable content id — NOT a vocab/writing
 * column. Everything kind-specific lives behind the AssignableKind adapter
 * (lib/assignments/kinds), so a new kind is additive with no schema change. The
 * client NEVER switches on kind: the server resolves a ref into a ContentCard
 * (title/emoji/doHref) and an AssignmentProgress, and the UI just renders those.
 */

/** Registry keys. Slice 1 ships only `vocab_collection`; `writing_prompt` is a
 *  drop-in adapter in Slice 2 (adding the string here + one adapter file). */
export const ASSIGNMENT_KINDS = ["vocab_collection"] as const;
export type AssignmentKind = (typeof ASSIGNMENT_KINDS)[number];

/** Length/size caps (mirror the class caps' spirit). */
export const ASSIGNMENT_TITLE_MAX = 120;
export const ASSIGNMENT_INSTRUCTIONS_MAX = 1000;
/** Max targeted students per "New assignment" submission (also a zod cap). */
export const ASSIGNMENT_TARGETS_MAX = 200;

/** How an assignment names its content. */
export interface ContentRef {
  kind: AssignmentKind;
  ref: string;
}

/** What the server resolves a ref into for DISPLAY. The client renders this and
 *  routes with `doHref` — it never switches on `kind`. `available:false` ⇒ the
 *  content was deleted / is no longer visible (show a disabled card). */
export interface ContentCard {
  kind: AssignmentKind;
  ref: string;
  title: string;
  emoji: string;
  subtitle: string;
  doHref: string;
  available: boolean;
}

/** A pickable content item in the teacher's kind-aware picker (GET
 *  /api/assignments/content?kind=). Same shape as ContentCard minus `available`. */
export type PickableContent = Omit<ContentCard, "available">;

/** One kind's picker tab (GET /api/assignments/kinds) — drives the tab strip. */
export interface KindTab {
  kind: AssignmentKind;
  label: string;
  emoji: string;
}

/** The per-student completion verdict a card/grid renders. `state` is derived
 *  live; `detail` is human text ("Practiced 3 / 20 words"). */
export interface AssignmentProgress {
  state: "not_started" | "in_progress" | "complete";
  pct: number; // 0..100
  detail: string;
}

/** One row of the `assignments` table. */
export interface AssignmentRow {
  id: string;
  class_id: string;
  content_kind: AssignmentKind;
  content_ref: string;
  title: string;
  instructions: string;
  criteria: string; // JSON completion rule, or '' for the kind default
  due_at: number | null;
  created_by: string;
  created_at: number;
  archived_at: number | null;
}

/** How a teacher sees one assignment in a class list. */
export interface TeacherAssignment {
  id: string;
  title: string; // effective title (assignment.title or the content's title)
  instructions: string;
  content: ContentCard;
  due_at: number | null;
  created_at: number;
  targetCount: number; // current students still targeted
  completeCount: number; // of those, how many are "practiced"
  overdue: boolean; // due date passed and not everyone is done
}

/** One student row in the teacher's per-assignment completion view. */
export interface AssignmentStudentRow {
  user_id: string;
  name: string;
  email: string;
  progress: AssignmentProgress;
  /** Due date passed and this student isn't complete (computed server-side). */
  overdue: boolean;
}

/** How a student sees one assignment (hub roll-up, class list, own detail). */
export interface StudentAssignment {
  id: string;
  class_id: string;
  className: string;
  classEmoji: string;
  title: string;
  instructions: string;
  content: ContentCard;
  due_at: number | null;
  overdue: boolean; // due date passed and not yet complete
  progress: AssignmentProgress;
}

/** GET /api/classes/[id]/assignments — role-shaped, like ClassDetail. */
export type ClassAssignments =
  | { role: "teacher"; assignments: TeacherAssignment[] }
  | { role: "student"; assignments: StudentAssignment[] };

/** GET /api/assignments/[assignmentId] — role-shaped detail. */
export type AssignmentDetail =
  | {
      role: "teacher";
      id: string;
      classId: string;
      className: string;
      title: string;
      instructions: string;
      content: ContentCard;
      due_at: number | null;
      created_at: number;
      students: AssignmentStudentRow[];
      completeCount: number;
      targetCount: number;
    }
  | { role: "student"; assignment: StudentAssignment };

/** The target for a new assignment. Slice 1: specific students only. */
export interface AssignmentTargetInput {
  studentIds: string[];
}
