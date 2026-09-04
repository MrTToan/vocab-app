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
import { getUserEmail } from "../auth/store";
import { sendInviteEmail } from "../email/invite";
import { classCaps, ClassCapError } from "./config";
import {
  CONSENT_NOTICE,
  JOIN_CODE_ALPHABET,
  JOIN_CODE_LENGTH,
  type ClassDetail,
  type ClassRole,
  type ClassRow,
  type CreatedInvite,
  type CreateInvitesResult,
  type EnrolledClass,
  type JoinPreview,
  type MyClassesData,
  type PendingInvite,
  type RosterEntry,
  type TeacherInvite,
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

/** Normalize an email the way `users.email` is stored (trim + lowercase). */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** A lenient "looks like an email" check — the store drops non-matching entries
 *  from an invite batch rather than failing the whole request. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function isEmailish(email: string): boolean {
  return EMAIL_RE.test(email);
}

/** An opaque, URL-safe accept-link token (~120 bits). Unique per invite; the
 *  UNIQUE(token) index is the link-lookup key and the accept authorization
 *  still re-checks the caller's email, so the token is a pointer, not a bearer
 *  credential that bypasses consent. */
function makeInviteToken(): string {
  return randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "").slice(0, 8);
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

  /**
   * The trust-critical authorization for route 17 (the teacher report view):
   * TRUE only when `teacherId` holds a role='teacher' row AND `studentId` holds a
   * role='student' row, BOTH in `classId`. This is the sole gate on the only
   * place in the app `forUser()` is called with an id other than the caller's, so
   * it must be exactly this — nothing looser (teaching *some* class, or the two
   * merely sharing a class in any role, would leak a student's whole history).
   */
  async teachesStudent(classId: string, teacherId: string, studentId: string): Promise<boolean> {
    const c = await connect();
    const rs = await c.execute({
      sql: `SELECT
              EXISTS(SELECT 1 FROM class_members WHERE class_id = ? AND user_id = ? AND role = 'teacher') AS is_teacher,
              EXISTS(SELECT 1 FROM class_members WHERE class_id = ? AND user_id = ? AND role = 'student') AS is_student`,
      args: [classId, teacherId, classId, studentId],
    });
    const row = rs.rows[0] as Record<string, unknown> | undefined;
    return Number(row?.is_teacher ?? 0) === 1 && Number(row?.is_student ?? 0) === 1;
  },

  /** Display name of a student in a class (from users), for the report header.
   *  Only names an actual role='student' membership row. */
  async studentName(classId: string, studentId: string): Promise<string> {
    const c = await connect();
    const rs = await c.execute({
      sql: `SELECT u.name, u.email
              FROM class_members cm LEFT JOIN users u ON u.id = cm.user_id
             WHERE cm.class_id = ? AND cm.user_id = ? AND cm.role = 'student' LIMIT 1`,
      args: [classId, studentId],
    });
    const row = rs.rows[0] as Record<string, unknown> | undefined;
    return String(row?.name ?? row?.email ?? "");
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
      const invites = await raw.pendingInvitesForClass(classId);
      return { role: "teacher", class: cls, students, studentCount: students.length, invites, archived };
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

  // ── email invites (Slice 3) ────────────────────────────────────────────

  /** Pending invites for one class (teacher's revoke list). */
  async pendingInvitesForClass(classId: string): Promise<TeacherInvite[]> {
    const c = await connect();
    const rs = await c.execute({
      sql: `SELECT id, email, status, created_at FROM class_invites
             WHERE class_id = ? AND status = 'pending'
             ORDER BY created_at ASC`,
      args: [classId],
    });
    return (rs.rows as Record<string, unknown>[]).map((r) => ({
      id: String(r.id),
      email: String(r.email ?? ""),
      status: "pending",
      created_at: Number(r.created_at ?? 0),
    }));
  },

  /** Count of pending invites for a class (for the non-blocking cap warning). */
  async pendingInviteCount(classId: string): Promise<number> {
    const c = await connect();
    const rs = await c.execute({
      sql: "SELECT COUNT(*) AS n FROM class_invites WHERE class_id = ? AND status = 'pending'",
      args: [classId],
    });
    return Number(rs.rows[0]?.n ?? 0);
  },

  /**
   * Create/refresh invites for a class (teacher-only). Idempotent per email via
   * UNIQUE(class_id, email): re-inviting the same address updates the existing
   * row (new token, back to pending) instead of duplicating — UNLESS it was
   * already accepted, which is preserved (the student is already a member).
   * `origin` builds the copyable accept link. No seat is taken here.
   */
  async createInvites(
    classId: string,
    userId: string,
    emails: string[],
    origin: string,
  ): Promise<CreateInvitesResult> {
    if ((await raw.roleOf(classId, userId)) !== "teacher") throw new ForbiddenError();
    const c = await connect();
    const now = Date.now();
    // Normalize, keep only email-shaped entries, dedupe (last wins).
    const seen = new Map<string, string>();
    for (const e of emails) {
      const norm = normalizeEmail(e);
      if (isEmailish(norm)) seen.set(norm, norm);
    }
    const created: CreatedInvite[] = [];
    for (const email of seen.keys()) {
      await c.execute({
        sql: `INSERT INTO class_invites (id, class_id, email, invited_by, token, status, created_at, responded_at)
              VALUES (?, ?, ?, ?, ?, 'pending', ?, NULL)
              ON CONFLICT(class_id, email) DO UPDATE SET
                invited_by   = excluded.invited_by,
                token        = CASE WHEN class_invites.status = 'accepted' THEN class_invites.token ELSE excluded.token END,
                status       = CASE WHEN class_invites.status = 'accepted' THEN 'accepted' ELSE 'pending' END,
                created_at   = excluded.created_at,
                responded_at = CASE WHEN class_invites.status = 'accepted' THEN class_invites.responded_at ELSE NULL END`,
        args: [randomUUID(), classId, email, userId, makeInviteToken(), now],
      });
      // Re-read by the unique (class_id,email) key to get the persisted id/token
      // (the row may have pre-existed, keeping its original id).
      const rs = await c.execute({
        sql: "SELECT id, email, token, status FROM class_invites WHERE class_id = ? AND email = ? LIMIT 1",
        args: [classId, email],
      });
      const row = rs.rows[0] as Record<string, unknown> | undefined;
      if (!row) continue;
      const token = row.token == null ? null : String(row.token);
      created.push({
        id: String(row.id),
        email: String(row.email ?? email),
        status: (row.status === "accepted" ? "accepted" : "pending") as CreatedInvite["status"],
        acceptLink: token ? `${origin}/classes?invite=${encodeURIComponent(token)}` : `${origin}/classes`,
        emailed: false,
      });
    }

    // Email the accept link to each newly-created / still-pending address
    // (best-effort, non-blocking). Already-accepted rows are skipped — the
    // student is a member, so re-inviting must not spam them. Sending never
    // fails invite creation: a `skipped` outcome (no RESEND_API_KEY, e.g. dev)
    // quietly leaves the copyable link as the delivery path; an `error` outcome
    // surfaces a soft warning so the teacher shares the link manually.
    const toEmail = created.filter((inv) => inv.status === "pending");
    let emailErrors = 0;
    if (toEmail.length > 0) {
      const [cls, teachers] = await Promise.all([raw.getClass(classId), raw.teacherNames(classId)]);
      const className = cls?.name ?? "your class";
      const teacherName =
        teachers.find((t) => t.user_id === userId)?.name ?? teachers[0]?.name ?? "Your teacher";
      await Promise.all(
        toEmail.map(async (inv) => {
          const outcome = await sendInviteEmail({
            to: inv.email,
            className,
            teacherName,
            acceptLink: inv.acceptLink,
          });
          if (outcome.status === "sent") inv.emailed = true;
          else if (outcome.status === "error") emailErrors += 1;
          // "skipped": email not configured — leave emailed=false silently.
        }),
      );
    }

    // Non-blocking cap warning: a seat is taken only on accept, so we never block
    // creation, but we warn if everyone accepting would overflow the class.
    const caps = classCaps();
    const [students, pending] = await Promise.all([
      raw.studentCount(classId),
      raw.pendingInviteCount(classId),
    ]);
    const warnings: string[] = [];
    if (students + pending > caps.studentsPerClass) {
      warnings.push(
        `Heads up: ${students} student${students === 1 ? "" : "s"} plus ${pending} pending invite${pending === 1 ? "" : "s"} exceeds this class's limit of ${caps.studentsPerClass}. Seats are only taken when someone accepts, so some invites may not fit.`,
      );
    }
    if (emailErrors > 0) {
      warnings.push(
        `Couldn't email ${emailErrors} invite${emailErrors === 1 ? "" : "s"} — copy the accept link${emailErrors === 1 ? "" : "s"} below and share ${emailErrors === 1 ? "it" : "them"} directly.`,
      );
    }
    const warning = warnings.length > 0 ? warnings.join(" ") : undefined;
    return { invites: created, ...(warning ? { warning } : {}) };
  },

  /** Revoke a pending invite (teacher-only). Idempotent. */
  async revokeInvite(classId: string, userId: string, inviteId: string): Promise<void> {
    if ((await raw.roleOf(classId, userId)) !== "teacher") throw new ForbiddenError();
    const c = await connect();
    await c.execute({
      sql: "UPDATE class_invites SET status = 'revoked', responded_at = ? WHERE id = ? AND class_id = ? AND status = 'pending'",
      args: [Date.now(), inviteId, classId],
    });
  },

  /** Pending invites addressed to the caller's email (the hub banner). */
  async listInvitesForMe(userId: string): Promise<PendingInvite[]> {
    const email = await getUserEmail(userId);
    if (!email) return [];
    const c = await connect();
    const rs = await c.execute({
      sql: `SELECT ci.id, ci.token, cl.id AS class_id, cl.name, cl.emoji
              FROM class_invites ci JOIN classes cl ON cl.id = ci.class_id
             WHERE ci.email = ? AND ci.status = 'pending' AND cl.archived_at IS NULL
             ORDER BY ci.created_at DESC`,
      args: [email],
    });
    const out: PendingInvite[] = [];
    for (const r of rs.rows as Record<string, unknown>[]) {
      const classId = String(r.class_id);
      const teachers = await raw.teacherNames(classId);
      out.push({
        id: String(r.id),
        token: r.token == null ? null : String(r.token),
        class: { id: classId, name: String(r.name ?? ""), emoji: String(r.emoji ?? "") },
        teacher: { name: teachers[0]?.name ?? "A teacher" },
      });
    }
    return out;
  },

  /** Load an invite by id, but only if it is addressed to the caller's email.
   *  Returns undefined otherwise (→ 404, so an invite's existence is not leaked
   *  to anyone but its intended recipient). */
  async inviteForCaller(
    inviteId: string,
    userId: string,
  ): Promise<{ id: string; class_id: string; email: string; status: string } | undefined> {
    const email = await getUserEmail(userId);
    if (!email) return undefined;
    const c = await connect();
    const rs = await c.execute({
      sql: "SELECT id, class_id, email, status FROM class_invites WHERE id = ? AND email = ? LIMIT 1",
      args: [inviteId, email],
    });
    const row = rs.rows[0] as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return {
      id: String(row.id),
      class_id: String(row.class_id),
      email: String(row.email ?? ""),
      status: String(row.status ?? ""),
    };
  },

  /**
   * Accept an invite (the CONSENT write — the route only reaches here after the
   * consent screen). The caller's email must match the invite (else undefined →
   * 404). Seat-guarded student insert (joined_via='invite'), then the invite is
   * marked accepted. The last-seat race is closed exactly as join-by-code: two
   * invited students racing for the final seat → one 'joined', the other
   * ClassCapError (→ 409); the loser's invite stays pending.
   */
  async acceptInvite(
    inviteId: string,
    userId: string,
  ): Promise<{ status: "joined" | "already"; class: ClassRow } | undefined> {
    const invite = await raw.inviteForCaller(inviteId, userId);
    if (!invite) return undefined; // wrong email / no such invite → 404
    // A revoked or declined invite is no longer actionable (its link is dead);
    // treat it as not-found. An 'accepted' invite still flows through the
    // seat-guard below so a re-accept after leaving is benign.
    if (invite.status === "revoked" || invite.status === "declined") return undefined;
    const c = await connect();
    const caps = classCaps();
    const now = Date.now();
    const cls = await raw.getClass(invite.class_id);
    if (!cls || cls.archived_at != null) return undefined; // class gone → 404
    const classId = invite.class_id;
    const rs = await c.execute({
      sql: `INSERT INTO class_members (class_id, user_id, role, joined_via, joined_at)
            SELECT ?, ?, 'student', 'invite', ?
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
      await raw.markInvite(inviteId, "accepted", now);
      return { status: "joined", class: (await raw.getClass(classId))! };
    }
    // Insert rejected — already a member is benign (still mark the invite done);
    // otherwise a cap was hit (leave the invite pending so it can be retried).
    if ((await raw.roleOf(classId, userId)) !== null) {
      await raw.markInvite(inviteId, "accepted", now);
      return { status: "already", class: (await raw.getClass(classId))! };
    }
    if ((await raw.studentCount(classId)) >= caps.studentsPerClass) throw new ClassCapError("students");
    throw new ClassCapError("memberships");
  },

  /** Decline an invite (the invited user). Email-matched (else false → 404).
   *  Only a still-pending invite is declinable. */
  async declineInvite(inviteId: string, userId: string): Promise<boolean> {
    const invite = await raw.inviteForCaller(inviteId, userId);
    if (!invite || invite.status !== "pending") return false;
    await raw.markInvite(inviteId, "declined", Date.now());
    return true;
  },

  async markInvite(inviteId: string, status: "accepted" | "declined", at: number): Promise<void> {
    const c = await connect();
    await c.execute({
      sql: "UPDATE class_invites SET status = ?, responded_at = ? WHERE id = ?",
      args: [status, at, inviteId],
    });
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
  /** True when the caller teaches `classId` AND `studentId` is a student in it —
   *  the sole gate for the teacher report view (route 17). */
  teachesStudent(classId: string, studentId: string): Promise<boolean>;
  /** A student's display name in a class (for the report header). */
  studentName(classId: string, studentId: string): Promise<string>;
  // ── email invites (Slice 3) ──
  /** Teacher-only: create/refresh idempotent invites; `origin` builds the link. */
  createInvites(classId: string, emails: string[], origin: string): Promise<CreateInvitesResult>;
  /** Teacher-only: revoke a pending invite. */
  revokeInvite(classId: string, inviteId: string): Promise<void>;
  /** Pending invites addressed to the caller's email (the hub banner). */
  listInvitesForMe(): Promise<PendingInvite[]>;
  /** Accept an invite addressed to the caller (the consent write). 404 → undefined. */
  acceptInvite(inviteId: string): Promise<{ status: "joined" | "already"; class: ClassRow } | undefined>;
  /** Decline an invite addressed to the caller. False → 404. */
  declineInvite(inviteId: string): Promise<boolean>;
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
      teachesStudent: (classId, studentId) => raw.teachesStudent(classId, userId, studentId),
      studentName: (classId, studentId) => raw.studentName(classId, studentId),
      createInvites: (classId, emails, origin) => raw.createInvites(classId, userId, emails, origin),
      revokeInvite: (classId, inviteId) => raw.revokeInvite(classId, userId, inviteId),
      listInvitesForMe: () => raw.listInvitesForMe(userId),
      acceptInvite: (inviteId) => raw.acceptInvite(inviteId, userId),
      declineInvite: (inviteId) => raw.declineInvite(inviteId, userId),
    };
  },
};
