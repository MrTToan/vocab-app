/*
 * Classes store — the class entity + the user↔class membership junction.
 *
 * A self-contained module in the spirit of lib/feedback/store.ts: the `classes`
 * and `class_members` tables + their indexes live in migrate() (lib/db.ts) and
 * the shared client comes from getDb(); this file only reads/writes rows.
 *
 * Everything a route needs goes through `classesStore.forUser(userId)` — a view
 * bound to the signed-in caller. All authorization lives HERE, never in the
 * route: teacher-only actions throw `ForbiddenError` (→ 403 via the api wrapper,
 * matched by name), a non-member reading a class detail gets `undefined`
 * (→ 404, so class existence is not leaked), and an over-cap write throws a
 * typed `ClassCapError` (→ 409). Caps are enforced with the quota ledger's
 * atomic guarded-insert idiom (design report §2.4) so the last-seat race is
 * closed: the COUNT sub-queries are evaluated under the same write lock as the
 * INSERT on the single shared connection.
 */

import { randomUUID } from "crypto";
import type { Client } from "@libsql/client";
import { getDb } from "../db";
import { classCaps, ClassCapError } from "./config";
import {
  CONSENT_NOTICE,
  JOIN_CODE_ALPHABET,
  JOIN_CODE_LENGTH,
  type ClassDetail,
  type ClassRole,
  type ClassRow,
  type EnrolledClass,
  type JoinPreview,
  type MyClassesData,
  type RosterEntry,
  type TeachingClass,
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

function rowToClass(r: Record<string, unknown>): ClassRow {
  return {
    id: String(r.id),
    name: String(r.name ?? ""),
    description: r.description == null ? "" : String(r.description),
    emoji: r.emoji == null ? "" : String(r.emoji),
    created_by: String(r.created_by ?? ""),
    join_code: r.join_code == null ? null : String(r.join_code),
    created_at: Number(r.created_at ?? 0),
    archived_at: r.archived_at == null ? null : Number(r.archived_at),
  };
}

/** A random unambiguous base32 join code. */
function makeJoinCode(): string {
  let out = "";
  for (let i = 0; i < JOIN_CODE_LENGTH; i++) {
    out += JOIN_CODE_ALPHABET[Math.floor(Math.random() * JOIN_CODE_ALPHABET.length)];
  }
  return out;
}

/** Normalize a user-supplied code: strip spaces/dashes, uppercase. */
export function normalizeJoinCode(code: string): string {
  return code.replace(/[\s-]/g, "").toUpperCase();
}

const raw = {
  async getClass(classId: string): Promise<ClassRow | undefined> {
    const c = await connect();
    const rs = await c.execute({ sql: "SELECT * FROM classes WHERE id = ? LIMIT 1", args: [classId] });
    return rs.rows[0] ? rowToClass(rs.rows[0] as Record<string, unknown>) : undefined;
  },

  /** The caller's role in a class, or null when they are not a member. */
  async roleOf(classId: string, userId: string): Promise<ClassRole | null> {
    const c = await connect();
    const rs = await c.execute({
      sql: "SELECT role FROM class_members WHERE class_id = ? AND user_id = ? LIMIT 1",
      args: [classId, userId],
    });
    const role = rs.rows[0]?.role;
    return role === "teacher" || role === "student" ? role : null;
  },

  async studentCount(classId: string): Promise<number> {
    const c = await connect();
    const rs = await c.execute({
      sql: "SELECT COUNT(*) AS n FROM class_members WHERE class_id = ? AND role = 'student'",
      args: [classId],
    });
    return Number(rs.rows[0]?.n ?? 0);
  },

  async membershipCount(userId: string): Promise<number> {
    const c = await connect();
    const rs = await c.execute({
      sql: "SELECT COUNT(*) AS n FROM class_members WHERE user_id = ?",
      args: [userId],
    });
    return Number(rs.rows[0]?.n ?? 0);
  },

  async teacherNames(classId: string): Promise<{ user_id: string; name: string }[]> {
    const c = await connect();
    const rs = await c.execute({
      sql: `SELECT cm.user_id, u.name, u.email
              FROM class_members cm LEFT JOIN users u ON u.id = cm.user_id
             WHERE cm.class_id = ? AND cm.role = 'teacher'
             ORDER BY cm.joined_at ASC`,
      args: [classId],
    });
    return (rs.rows as Record<string, unknown>[]).map((r) => ({
      user_id: String(r.user_id),
      name: String(r.name ?? r.email ?? "A teacher"),
    }));
  },

  async roster(classId: string): Promise<RosterEntry[]> {
    const c = await connect();
    const rs = await c.execute({
      sql: `SELECT cm.user_id, cm.joined_at, cm.joined_via, u.name, u.email
              FROM class_members cm LEFT JOIN users u ON u.id = cm.user_id
             WHERE cm.class_id = ? AND cm.role = 'student'
             ORDER BY cm.joined_at ASC`,
      args: [classId],
    });
    return (rs.rows as Record<string, unknown>[]).map((r) => ({
      user_id: String(r.user_id),
      name: String(r.name ?? ""),
      email: String(r.email ?? ""),
      joined_at: Number(r.joined_at ?? 0),
      joined_via: (r.joined_via == null ? null : String(r.joined_via)) as RosterEntry["joined_via"],
    }));
  },

  // ── writes ────────────────────────────────────────────────────────────

  async createClass(
    userId: string,
    input: { name: string; description?: string; emoji?: string },
  ): Promise<ClassRow> {
    const c = await connect();
    const caps = classCaps();
    const id = randomUUID();
    const now = Date.now();
    // Guarded insert: the class row is created only while the creator is under
    // BOTH the classes-per-teacher cap (active classes) and the memberships cap.
    // rowsAffected === 0 ⇒ a cap was hit; a cheap follow-up disambiguates which.
    const rs = await c.execute({
      sql: `INSERT INTO classes (id, name, description, emoji, created_by, join_code, created_at, archived_at)
            SELECT ?, ?, ?, ?, ?, NULL, ?, NULL
             WHERE (SELECT COUNT(*) FROM classes WHERE created_by = ? AND archived_at IS NULL) < ?
               AND (SELECT COUNT(*) FROM class_members WHERE user_id = ?) < ?`,
      args: [
        id,
        input.name,
        input.description ?? "",
        input.emoji ?? "",
        userId,
        now,
        userId,
        caps.classesPerTeacher,
        userId,
        caps.membershipsPerAccount,
      ],
    });
    if (Number(rs.rowsAffected) === 0) {
      const mine = await c.execute({
        sql: "SELECT COUNT(*) AS n FROM classes WHERE created_by = ? AND archived_at IS NULL",
        args: [userId],
      });
      if (Number(mine.rows[0]?.n ?? 0) >= caps.classesPerTeacher) throw new ClassCapError("classes");
      throw new ClassCapError("memberships");
    }
    // The creator holds a role='teacher' membership row (joined_via='creator').
    // `created_by` remains the immutable owner for archive + the create cap.
    await c.execute({
      sql: `INSERT INTO class_members (class_id, user_id, role, joined_via, joined_at)
            VALUES (?, ?, 'teacher', 'creator', ?)`,
      args: [id, userId, now],
    });
    return (await raw.getClass(id))!;
  },

  async updateClass(
    classId: string,
    userId: string,
    patch: { name?: string; description?: string; emoji?: string },
  ): Promise<ClassRow | undefined> {
    if ((await raw.roleOf(classId, userId)) !== "teacher") throw new ForbiddenError();
    const sets: string[] = [];
    const args: string[] = [];
    if (patch.name !== undefined) {
      sets.push("name = ?");
      args.push(patch.name);
    }
    if (patch.description !== undefined) {
      sets.push("description = ?");
      args.push(patch.description);
    }
    if (patch.emoji !== undefined) {
      sets.push("emoji = ?");
      args.push(patch.emoji);
    }
    if (sets.length === 0) return raw.getClass(classId);
    const c = await connect();
    args.push(classId);
    await c.execute({ sql: `UPDATE classes SET ${sets.join(", ")} WHERE id = ?`, args });
    return raw.getClass(classId);
  },

  async setJoinCode(classId: string, userId: string): Promise<string> {
    if ((await raw.roleOf(classId, userId)) !== "teacher") throw new ForbiddenError();
    const c = await connect();
    // Retry on the (astronomically unlikely) unique-code collision.
    for (let attempt = 0; attempt < 6; attempt++) {
      const code = makeJoinCode();
      try {
        await c.execute({
          sql: "UPDATE classes SET join_code = ? WHERE id = ?",
          args: [code, classId],
        });
        return code;
      } catch (err) {
        if (attempt === 5) throw err;
      }
    }
    throw new Error("could not allocate a join code");
  },

  async disableJoinCode(classId: string, userId: string): Promise<void> {
    if ((await raw.roleOf(classId, userId)) !== "teacher") throw new ForbiddenError();
    const c = await connect();
    await c.execute({ sql: "UPDATE classes SET join_code = NULL WHERE id = ?", args: [classId] });
  },

  async archiveClass(classId: string, userId: string): Promise<void> {
    const cls = await raw.getClass(classId);
    if (!cls) return; // idempotent: already gone
    // Only the immutable creator may archive (not a co-teacher).
    if (cls.created_by !== userId) throw new ForbiddenError();
    const c = await connect();
    // Null the join code too: an archived class must not be joinable and its
    // code frees up (joinByCode already filters archived_at IS NULL as well).
    await c.execute({
      sql: "UPDATE classes SET archived_at = ?, join_code = NULL WHERE id = ?",
      args: [Date.now(), classId],
    });
  },

  async removeStudent(classId: string, userId: string, studentId: string): Promise<void> {
    if ((await raw.roleOf(classId, userId)) !== "teacher") throw new ForbiddenError();
    const c = await connect();
    // Only a student row is removable this way — a teacher can't delete a
    // teacher membership through the roster. Revokes report visibility at once.
    await c.execute({
      sql: "DELETE FROM class_members WHERE class_id = ? AND user_id = ? AND role = 'student'",
      args: [classId, studentId],
    });
  },

  async leaveClass(classId: string, userId: string): Promise<void> {
    const c = await connect();
    // A student leaves their own class. Scoped to role='student' so the creator
    // can't accidentally drop their teacher row (they archive instead).
    await c.execute({
      sql: "DELETE FROM class_members WHERE class_id = ? AND user_id = ? AND role = 'student'",
      args: [classId, userId],
    });
  },

  /** Preview a code without writing — feeds the consent screen. */
  async joinPreview(code: string): Promise<JoinPreview | undefined> {
    const c = await connect();
    const rs = await c.execute({
      sql: "SELECT id, name, emoji FROM classes WHERE join_code = ? AND archived_at IS NULL LIMIT 1",
      args: [code],
    });
    const row = rs.rows[0] as Record<string, unknown> | undefined;
    if (!row) return undefined;
    const classId = String(row.id);
    const teachers = await raw.teacherNames(classId);
    return {
      class: { id: classId, name: String(row.name ?? ""), emoji: String(row.emoji ?? "") },
      teacher: { name: teachers[0]?.name ?? "A teacher" },
      consent: CONSENT_NOTICE,
    };
  },

  /**
   * Redeem a join code as a student. The seat-guarded insert admits at most one
   * of two racers for the last seat; a rejected write is disambiguated into
   * already-member (benign) vs cap-hit (ClassCapError) vs not-found (undefined).
   */
  async joinByCode(
    code: string,
    userId: string,
  ): Promise<{ status: "joined" | "already"; class: ClassRow } | undefined> {
    const c = await connect();
    const caps = classCaps();
    const now = Date.now();
    const found = await c.execute({
      sql: "SELECT id FROM classes WHERE join_code = ? AND archived_at IS NULL LIMIT 1",
      args: [code],
    });
    const row = found.rows[0] as Record<string, unknown> | undefined;
    if (!row) return undefined; // bad/disabled code → 404
    const classId = String(row.id);
    const rs = await c.execute({
      sql: `INSERT INTO class_members (class_id, user_id, role, joined_via, joined_at)
            SELECT ?, ?, 'student', 'code', ?
             WHERE (SELECT COUNT(*) FROM class_members WHERE class_id = ? AND role = 'student') < ?
               AND (SELECT COUNT(*) FROM class_members WHERE user_id = ?) < ?
               AND NOT EXISTS (SELECT 1 FROM class_members WHERE class_id = ? AND user_id = ?)`,
      args: [
        classId,
        userId,
        now,
        classId,
        caps.studentsPerClass,
        userId,
        caps.membershipsPerAccount,
        classId,
        userId,
      ],
    });
    if (Number(rs.rowsAffected) === 1) {
      return { status: "joined", class: (await raw.getClass(classId))! };
    }
    // Rejected — figure out why (already-member is benign; the caps are 409).
    if ((await raw.roleOf(classId, userId)) !== null) {
      return { status: "already", class: (await raw.getClass(classId))! };
    }
    if ((await raw.studentCount(classId)) >= caps.studentsPerClass) throw new ClassCapError("students");
    throw new ClassCapError("memberships");
  },

  async listMine(userId: string): Promise<MyClassesData> {
    const c = await connect();
    // Active classes the caller is a member of, split by their per-class role.
    const rs = await c.execute({
      sql: `SELECT cl.*, cm.role AS my_role, cm.joined_at AS my_joined_at
              FROM class_members cm JOIN classes cl ON cl.id = cm.class_id
             WHERE cm.user_id = ? AND cl.archived_at IS NULL
             ORDER BY cm.joined_at DESC`,
      args: [userId],
    });
    const teaching: TeachingClass[] = [];
    const enrolled: EnrolledClass[] = [];
    for (const r of rs.rows as Record<string, unknown>[]) {
      const cls = rowToClass(r);
      if (r.my_role === "teacher") {
        teaching.push({
          id: cls.id,
          name: cls.name,
          emoji: cls.emoji,
          description: cls.description,
          studentCount: await raw.studentCount(cls.id),
          join_code: cls.join_code,
          created_at: cls.created_at,
        });
      } else {
        const teachers = await raw.teacherNames(cls.id);
        enrolled.push({
          id: cls.id,
          name: cls.name,
          emoji: cls.emoji,
          description: cls.description,
          teacherNames: teachers.map((t) => t.name),
          joined_at: Number(r.my_joined_at ?? 0),
        });
      }
    }
    return { teaching, enrolled, invites: [] };
  },

  /** Member-gated detail. Non-members get undefined so the route 404s and never
   *  leaks a class's existence. */
  async getDetail(classId: string, userId: string): Promise<ClassDetail | undefined> {
    const cls = await raw.getClass(classId);
    if (!cls) return undefined;
    const role = await raw.roleOf(classId, userId);
    if (role === null) return undefined; // not a member → 404 (don't leak)
    const archived = cls.archived_at != null;
    if (role === "teacher") {
      const students = await raw.roster(classId);
      return { role: "teacher", class: cls, students, studentCount: students.length, archived };
    }
    const teachers = await raw.teacherNames(classId);
    const joined = await connect().then((c) =>
      c.execute({
        sql: "SELECT joined_at FROM class_members WHERE class_id = ? AND user_id = ? LIMIT 1",
        args: [classId, userId],
      }),
    );
    return {
      role: "student",
      class: { id: cls.id, name: cls.name, emoji: cls.emoji, description: cls.description },
      teachers,
      joined_at: Number(joined.rows[0]?.joined_at ?? 0),
      archived,
    };
  },
};

export interface ClassScope {
  createClass(input: { name: string; description?: string; emoji?: string }): Promise<ClassRow>;
  listMine(): Promise<MyClassesData>;
  getDetail(classId: string): Promise<ClassDetail | undefined>;
  updateClass(
    classId: string,
    patch: { name?: string; description?: string; emoji?: string },
  ): Promise<ClassRow | undefined>;
  setJoinCode(classId: string): Promise<string>;
  disableJoinCode(classId: string): Promise<void>;
  archiveClass(classId: string): Promise<void>;
  roster(classId: string): Promise<RosterEntry[]>;
  removeStudent(classId: string, studentId: string): Promise<void>;
  leaveClass(classId: string): Promise<void>;
  joinPreview(code: string): Promise<JoinPreview | undefined>;
  joinByCode(code: string): Promise<{ status: "joined" | "already"; class: ClassRow } | undefined>;
  /** True when the caller teaches this class (roster/remove authorization). */
  isTeacherOf(classId: string): Promise<boolean>;
}

export const classesStore = {
  /** A view of the store bound to one signed-in user. */
  forUser(userId: string): ClassScope {
    return {
      createClass: (input) => raw.createClass(userId, input),
      listMine: () => raw.listMine(userId),
      getDetail: (classId) => raw.getDetail(classId, userId),
      updateClass: (classId, patch) => raw.updateClass(classId, userId, patch),
      setJoinCode: (classId) => raw.setJoinCode(classId, userId),
      disableJoinCode: (classId) => raw.disableJoinCode(classId, userId),
      archiveClass: (classId) => raw.archiveClass(classId, userId),
      roster: async (classId) => {
        if ((await raw.roleOf(classId, userId)) !== "teacher") throw new ForbiddenError();
        return raw.roster(classId);
      },
      removeStudent: (classId, studentId) => raw.removeStudent(classId, userId, studentId),
      leaveClass: (classId) => raw.leaveClass(classId, userId),
      joinPreview: (code) => raw.joinPreview(code),
      joinByCode: (code) => raw.joinByCode(code, userId),
      isTeacherOf: async (classId) => (await raw.roleOf(classId, userId)) === "teacher",
    };
  },
};
