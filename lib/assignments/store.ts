/*
 * Assignments store — a teacher assigns EXISTING content (Slice 1: a vocab
 * collection) to specific students in a class, and both sides see completion.
 *
 * Self-contained in the spirit of lib/classes/store.ts: the `assignments` +
 * `assignment_targets` tables live in migrate() (lib/db.ts); this file only
 * reads/writes rows and delegates everything kind-specific to the AssignableKind
 * registry (lib/assignments/kinds). ALL authorization lives HERE, never in the
 * route: teacher-only actions throw ForbiddenError (→ 403 by name), a non-member
 * read returns undefined (→ 404, so a class/assignment's existence isn't leaked),
 * an over-cap or bad-input create throws AssignmentCapError/AssignmentInputError
 * (→ 409 / 400 by name). The teacher completion view reads a student's derived
 * progress only after confirming the caller teaches the class AND the student is a
 * current, targeted member of it — the same trust discipline as the report seam.
 */

import { randomUUID } from "crypto";
import type { Client } from "@libsql/client";
import { getDb } from "../db";
import { assignmentCaps, AssignmentCapError, AssignmentInputError } from "./config";
import { kindFor } from "./kinds";
import type {
  AssignmentDetail,
  AssignmentKind,
  AssignmentRow,
  AssignmentStudentRow,
  ClassAssignments,
  ContentCard,
  PickableContent,
  StudentAssignment,
  TeacherAssignment,
} from "./types";

/** Matches lib/store.ts's ForbiddenError (mapped to 403 by name in lib/api.ts). */
export class ForbiddenError extends Error {
  constructor(message = "forbidden") {
    super(message);
    this.name = "ForbiddenError";
  }
}

async function connect(): Promise<Client> {
  return getDb();
}

function rowToAssignment(r: Record<string, unknown>): AssignmentRow {
  return {
    id: String(r.id),
    class_id: String(r.class_id ?? ""),
    content_kind: String(r.content_kind ?? "") as AssignmentKind,
    content_ref: String(r.content_ref ?? ""),
    title: r.title == null ? "" : String(r.title),
    instructions: r.instructions == null ? "" : String(r.instructions),
    criteria: r.criteria == null ? "" : String(r.criteria),
    due_at: r.due_at == null ? null : Number(r.due_at),
    created_by: String(r.created_by ?? ""),
    created_at: Number(r.created_at ?? 0),
    archived_at: r.archived_at == null ? null : Number(r.archived_at),
  };
}

function parseCriteria(a: AssignmentRow): Record<string, unknown> {
  if (!a.criteria) return kindFor(a.content_kind)?.defaultCriteria() ?? {};
  try {
    return JSON.parse(a.criteria) as Record<string, unknown>;
  } catch {
    return kindFor(a.content_kind)?.defaultCriteria() ?? {};
  }
}

const overdue = (dueAt: number | null, complete: boolean, now: number) =>
  dueAt != null && dueAt < now && !complete;

const raw = {
  /** The caller's role in a class, or null when not a member. */
  async roleOf(classId: string, userId: string): Promise<"teacher" | "student" | null> {
    const c = await connect();
    const rs = await c.execute({
      sql: "SELECT role FROM class_members WHERE class_id = ? AND user_id = ? LIMIT 1",
      args: [classId, userId],
    });
    const role = rs.rows[0]?.role;
    return role === "teacher" || role === "student" ? role : null;
  },

  async getAssignment(id: string): Promise<AssignmentRow | undefined> {
    const c = await connect();
    const rs = await c.execute({ sql: "SELECT * FROM assignments WHERE id = ? LIMIT 1", args: [id] });
    return rs.rows[0] ? rowToAssignment(rs.rows[0] as Record<string, unknown>) : undefined;
  },

  /** Ids of the class's current students (role='student'). */
  async currentStudentIds(classId: string): Promise<string[]> {
    const c = await connect();
    const rs = await c.execute({
      sql: "SELECT user_id FROM class_members WHERE class_id = ? AND role = 'student'",
      args: [classId],
    });
    return (rs.rows as Record<string, unknown>[]).map((r) => String(r.user_id));
  },

  /** Targeted students who are STILL current students of the class, with display
   *  info — the live "who is this assignment for" set (a removed student drops out). */
  async liveTargets(
    assignmentId: string,
    classId: string,
  ): Promise<{ user_id: string; name: string; email: string }[]> {
    const c = await connect();
    const rs = await c.execute({
      sql: `SELECT t.user_id, u.name, u.email
              FROM assignment_targets t
              JOIN class_members cm ON cm.class_id = ? AND cm.user_id = t.user_id AND cm.role = 'student'
              LEFT JOIN users u ON u.id = t.user_id
             WHERE t.assignment_id = ?
             ORDER BY u.name ASC`,
      args: [classId, assignmentId],
    });
    return (rs.rows as Record<string, unknown>[]).map((r) => ({
      user_id: String(r.user_id),
      name: String(r.name ?? ""),
      email: String(r.email ?? ""),
    }));
  },

  // ── writes ──────────────────────────────────────────────────────────────

  async createAssignment(
    userId: string,
    classId: string,
    input: {
      kind: AssignmentKind;
      ref: string;
      title?: string;
      instructions?: string;
      dueAt?: number | null;
      studentIds: string[];
    },
  ): Promise<AssignmentRow> {
    // Teacher-only.
    if ((await raw.roleOf(classId, userId)) !== "teacher") throw new ForbiddenError();
    const adapter = kindFor(input.kind);
    if (!adapter) throw new AssignmentInputError("Unknown assignment type.");
    // Validate the content ref is real + assignable to this teacher.
    const check = await adapter.validateRef(input.ref, userId);
    if (!check.ok) throw new AssignmentInputError(check.reason ?? "That content can't be assigned.");
    // Keep only requested students who are ACTUALLY current students of the class.
    const inClass = new Set(await raw.currentStudentIds(classId));
    const targets = [...new Set(input.studentIds)].filter((id) => inClass.has(id));
    if (targets.length === 0) throw new AssignmentInputError("Select at least one student in this class.");
    // Per-class cap on active assignments.
    const c = await connect();
    const caps = assignmentCaps();
    const active = await c.execute({
      sql: "SELECT COUNT(*) AS n FROM assignments WHERE class_id = ? AND archived_at IS NULL",
      args: [classId],
    });
    if (Number(active.rows[0]?.n ?? 0) >= caps.perClass) throw new AssignmentCapError();

    const id = randomUUID();
    const now = Date.now();
    await c.execute({
      sql: `INSERT INTO assignments
              (id, class_id, content_kind, content_ref, title, instructions, criteria, due_at, created_by, created_at, archived_at)
            VALUES (?, ?, ?, ?, ?, ?, '', ?, ?, ?, NULL)`,
      args: [
        id,
        classId,
        input.kind,
        input.ref,
        (input.title ?? "").trim(),
        (input.instructions ?? "").trim(),
        input.dueAt ?? null,
        userId,
        now,
      ],
    });
    await c.batch(
      targets.map((sid) => ({
        sql: "INSERT OR IGNORE INTO assignment_targets (assignment_id, user_id, created_at) VALUES (?, ?, ?)",
        args: [id, sid, now],
      })),
      "write",
    );
    return (await raw.getAssignment(id))!;
  },

  async updateAssignment(
    assignmentId: string,
    userId: string,
    patch: { title?: string; instructions?: string; dueAt?: number | null },
  ): Promise<AssignmentRow | undefined> {
    const a = await raw.getAssignment(assignmentId);
    if (!a) return undefined;
    if ((await raw.roleOf(a.class_id, userId)) !== "teacher") throw new ForbiddenError();
    const sets: string[] = [];
    const args: (string | number | null)[] = [];
    if (patch.title !== undefined) {
      sets.push("title = ?");
      args.push(patch.title.trim());
    }
    if (patch.instructions !== undefined) {
      sets.push("instructions = ?");
      args.push(patch.instructions.trim());
    }
    if (patch.dueAt !== undefined) {
      sets.push("due_at = ?");
      args.push(patch.dueAt);
    }
    if (sets.length === 0) return a;
    const c = await connect();
    args.push(assignmentId);
    await c.execute({ sql: `UPDATE assignments SET ${sets.join(", ")} WHERE id = ?`, args });
    return raw.getAssignment(assignmentId);
  },

  /** Soft-archive (teacher-only). Idempotent. Revokes any granted practice access
   *  (collectionVisibleTo requires archived_at IS NULL). */
  async archiveAssignment(assignmentId: string, userId: string): Promise<void> {
    const a = await raw.getAssignment(assignmentId);
    if (!a) return; // idempotent
    if ((await raw.roleOf(a.class_id, userId)) !== "teacher") throw new ForbiddenError();
    const c = await connect();
    await c.execute({
      sql: "UPDATE assignments SET archived_at = ? WHERE id = ?",
      args: [Date.now(), assignmentId],
    });
  },

  // ── reads ───────────────────────────────────────────────────────────────

  /** The picker's content list for one kind (teacher-facing; a teacher of some
   *  class — enforced at the route via isTeacherOf-of-any is overkill, so this is
   *  scoped by the adapter to the caller's own+public content only). */
  async listPickable(userId: string, kind: string, q: string): Promise<PickableContent[]> {
    const adapter = kindFor(kind);
    if (!adapter) return [];
    return adapter.listPickable(userId, q);
  },

  /** GET /api/classes/[id]/assignments — role-shaped. undefined ⇒ 404 (non-member). */
  async listForClass(classId: string, userId: string): Promise<ClassAssignments | undefined> {
    const role = await raw.roleOf(classId, userId);
    if (role === null) return undefined; // not a member → 404
    const now = Date.now();
    const c = await connect();
    if (role === "teacher") {
      const rs = await c.execute({
        sql: `SELECT * FROM assignments
               WHERE class_id = ? AND archived_at IS NULL
               ORDER BY (due_at IS NULL), due_at ASC, created_at DESC`,
        args: [classId],
      });
      const rows = (rs.rows as Record<string, unknown>[]).map(rowToAssignment);
      const assignments: TeacherAssignment[] = [];
      for (const a of rows) {
        assignments.push(await raw.teacherAssignment(a, now));
      }
      return { role: "teacher", assignments };
    }
    // student
    const assignments = await raw.studentAssignments(userId, now, classId);
    return { role: "student", assignments };
  },

  /** GET /api/assignments — the caller's own assignments across every class. */
  async listMine(userId: string): Promise<StudentAssignment[]> {
    return raw.studentAssignments(userId, Date.now());
  },

  /** Build the teacher's list-row view for one assignment (card + completion). */
  async teacherAssignment(a: AssignmentRow, now: number): Promise<TeacherAssignment> {
    const adapter = kindFor(a.content_kind);
    const content: ContentCard = adapter
      ? await adapter.resolveCard(a.content_ref)
      : unknownCard(a);
    const targets = await raw.liveTargets(a.id, a.class_id);
    let completeCount = 0;
    if (adapter && targets.length) {
      const prog = await adapter.progressForMany(
        targets.map((t) => t.user_id),
        a.content_ref,
        parseCriteria(a),
      );
      completeCount = Object.values(prog).filter((p) => p.state === "complete").length;
    }
    return {
      id: a.id,
      title: a.title || content.title,
      instructions: a.instructions,
      content,
      due_at: a.due_at,
      created_at: a.created_at,
      targetCount: targets.length,
      completeCount,
      overdue: overdue(a.due_at, completeCount >= targets.length && targets.length > 0, now),
    };
  },

  /** Build the student's assignment rows (all classes, or one class). */
  async studentAssignments(
    userId: string,
    now: number,
    classId?: string,
  ): Promise<StudentAssignment[]> {
    const c = await connect();
    const rs = await c.execute({
      sql: `SELECT a.*, cl.name AS class_name, cl.emoji AS class_emoji
              FROM assignments a
              JOIN assignment_targets t ON t.assignment_id = a.id AND t.user_id = ?
              JOIN classes cl ON cl.id = a.class_id
              JOIN class_members cm ON cm.class_id = a.class_id AND cm.user_id = ? AND cm.role = 'student'
             WHERE a.archived_at IS NULL AND cl.archived_at IS NULL
               ${classId ? "AND a.class_id = ?" : ""}
             ORDER BY (a.due_at IS NULL), a.due_at ASC, a.created_at DESC`,
      args: classId ? [userId, userId, classId] : [userId, userId],
    });
    const out: StudentAssignment[] = [];
    for (const r of rs.rows as Record<string, unknown>[]) {
      const a = rowToAssignment(r);
      const adapter = kindFor(a.content_kind);
      const content = adapter ? await adapter.resolveCard(a.content_ref) : unknownCard(a);
      const progress = adapter
        ? await adapter.progressFor(userId, a.content_ref, parseCriteria(a))
        : { state: "not_started" as const, pct: 0, detail: "" };
      out.push({
        id: a.id,
        class_id: a.class_id,
        className: String(r.class_name ?? ""),
        classEmoji: r.class_emoji == null ? "" : String(r.class_emoji),
        title: a.title || content.title,
        instructions: a.instructions,
        content,
        due_at: a.due_at,
        overdue: overdue(a.due_at, progress.state === "complete", now),
        progress,
      });
    }
    return out;
  },

  /** GET /api/assignments/[id] — role-shaped detail. undefined ⇒ 404. */
  async getDetail(assignmentId: string, userId: string): Promise<AssignmentDetail | undefined> {
    const a = await raw.getAssignment(assignmentId);
    if (!a || a.archived_at != null) return undefined;
    const role = await raw.roleOf(a.class_id, userId);
    if (role === null) return undefined; // not a member of the class → 404
    const now = Date.now();
    const adapter = kindFor(a.content_kind);
    const content = adapter ? await adapter.resolveCard(a.content_ref) : unknownCard(a);

    if (role === "teacher") {
      const c = await connect();
      const clsRs = await c.execute({ sql: "SELECT name FROM classes WHERE id = ? LIMIT 1", args: [a.class_id] });
      const className = String((clsRs.rows[0] as Record<string, unknown> | undefined)?.name ?? "");
      const targets = await raw.liveTargets(a.id, a.class_id);
      const prog = adapter
        ? await adapter.progressForMany(targets.map((t) => t.user_id), a.content_ref, parseCriteria(a))
        : {};
      const students: AssignmentStudentRow[] = targets.map((t) => {
        const progress = prog[t.user_id] ?? { state: "not_started" as const, pct: 0, detail: "" };
        return {
          user_id: t.user_id,
          name: t.name,
          email: t.email,
          progress,
          overdue: overdue(a.due_at, progress.state === "complete", now),
        };
      });
      const completeCount = students.filter((s) => s.progress.state === "complete").length;
      return {
        role: "teacher",
        id: a.id,
        classId: a.class_id,
        className,
        title: a.title || content.title,
        instructions: a.instructions,
        content,
        due_at: a.due_at,
        created_at: a.created_at,
        students,
        completeCount,
        targetCount: students.length,
      };
    }

    // student — only if they are a target of this assignment
    const c = await connect();
    const t = await c.execute({
      sql: "SELECT 1 FROM assignment_targets WHERE assignment_id = ? AND user_id = ? LIMIT 1",
      args: [assignmentId, userId],
    });
    if (t.rows.length === 0) return undefined; // a member, but not a target → 404
    const clsRs = await c.execute({
      sql: "SELECT name, emoji FROM classes WHERE id = ? LIMIT 1",
      args: [a.class_id],
    });
    const cls = clsRs.rows[0] as Record<string, unknown> | undefined;
    const progress = adapter
      ? await adapter.progressFor(userId, a.content_ref, parseCriteria(a))
      : { state: "not_started" as const, pct: 0, detail: "" };
    return {
      role: "student",
      assignment: {
        id: a.id,
        class_id: a.class_id,
        className: String(cls?.name ?? ""),
        classEmoji: cls?.emoji == null ? "" : String(cls.emoji),
        title: a.title || content.title,
        instructions: a.instructions,
        content,
        due_at: a.due_at,
        overdue: overdue(a.due_at, progress.state === "complete", now),
        progress,
      },
    };
  },
};

/** Fallback card for an assignment whose kind is no longer registered. */
function unknownCard(a: AssignmentRow): ContentCard {
  return {
    kind: a.content_kind,
    ref: a.content_ref,
    title: "(unavailable)",
    emoji: "❔",
    subtitle: "this content type is unavailable",
    doHref: "#",
    available: false,
  };
}

export interface AssignmentScope {
  createAssignment(
    classId: string,
    input: {
      kind: AssignmentKind;
      ref: string;
      title?: string;
      instructions?: string;
      dueAt?: number | null;
      studentIds: string[];
    },
  ): Promise<AssignmentRow>;
  updateAssignment(
    assignmentId: string,
    patch: { title?: string; instructions?: string; dueAt?: number | null },
  ): Promise<AssignmentRow | undefined>;
  archiveAssignment(assignmentId: string): Promise<void>;
  listForClass(classId: string): Promise<ClassAssignments | undefined>;
  listMine(): Promise<StudentAssignment[]>;
  getDetail(assignmentId: string): Promise<AssignmentDetail | undefined>;
  listPickable(kind: string, q: string): Promise<PickableContent[]>;
}

export const assignmentsStore = {
  /** A view of the store bound to one signed-in user. */
  forUser(userId: string): AssignmentScope {
    return {
      createAssignment: (classId, input) => raw.createAssignment(userId, classId, input),
      updateAssignment: (assignmentId, patch) => raw.updateAssignment(assignmentId, userId, patch),
      archiveAssignment: (assignmentId) => raw.archiveAssignment(assignmentId, userId),
      listForClass: (classId) => raw.listForClass(classId, userId),
      listMine: () => raw.listMine(userId),
      getDetail: (assignmentId) => raw.getDetail(assignmentId, userId),
      listPickable: (kind, q) => raw.listPickable(userId, kind, q),
    };
  },
};
