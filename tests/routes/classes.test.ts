import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { get, post, patch, del, crossOrigin, ctx } from "./kit";

/*
 * Route + store coverage for the Classes feature (Slice 1). Real temp SQLite.
 * `currentUserId` is swapped per test between the teacher, students and a
 * stranger to exercise the membership/teacher authorization rules, the cap
 * enforcement (last-seat 409) and join idempotency.
 */

const caller = vi.hoisted(() => ({ id: "teacher-a" as string | null }));
vi.mock("@/lib/auth/user", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/auth/user")>();
  return { ...real, currentUserId: async () => caller.id };
});

// Next 16 route ctx with two params (students/[studentId]).
const ctx2 = (id: string, studentId: string) => ({ params: Promise.resolve({ id, studentId }) });

let classesRoute: typeof import("@/app/api/classes/route");
let byId: typeof import("@/app/api/classes/[id]/route");
let joinCode: typeof import("@/app/api/classes/[id]/join-code/route");
let join: typeof import("@/app/api/classes/join/route");
let students: typeof import("@/app/api/classes/[id]/students/route");
let studentById: typeof import("@/app/api/classes/[id]/students/[studentId]/route");
let studentReport: typeof import("@/app/api/classes/[id]/students/[studentId]/report/route");
let leave: typeof import("@/app/api/classes/[id]/leave/route");

async function json(res: Response) {
  return res.json();
}

beforeAll(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "lexi-classes-"));
  process.env.DATABASE_URL = `file:${path.join(dir, "t.db")}`;
  delete process.env.DATABASE_AUTH_TOKEN;
  delete process.env.SHEET_ID;
  delete process.env.AUTH_SECRET;
  delete process.env.AUTH_GOOGLE_ID;
  delete process.env.CLASS_MAX_STUDENTS;
  delete process.env.CLASS_MAX_CLASSES_PER_TEACHER;
  delete process.env.CLASS_MAX_MEMBERSHIPS;
  classesRoute = await import("@/app/api/classes/route");
  byId = await import("@/app/api/classes/[id]/route");
  joinCode = await import("@/app/api/classes/[id]/join-code/route");
  join = await import("@/app/api/classes/join/route");
  students = await import("@/app/api/classes/[id]/students/route");
  studentById = await import("@/app/api/classes/[id]/students/[studentId]/route");
  studentReport = await import("@/app/api/classes/[id]/students/[studentId]/report/route");
  leave = await import("@/app/api/classes/[id]/leave/route");
});

beforeEach(() => {
  caller.id = "teacher-a";
});

/** Create a class as the current caller and return its id + first join code. */
async function makeClass(name = "IELTS Evening") {
  const res = await classesRoute.POST(post("http://t/api/classes", { name }));
  const { class: cls } = await json(res);
  const codeRes = await joinCode.POST(post(`http://t/api/classes/${cls.id}/join-code`), ctx(cls.id));
  const { join_code } = await json(codeRes);
  return { id: cls.id as string, code: join_code as string };
}

describe("signed out -> 401", () => {
  it("GET /api/classes and POST /api/classes", async () => {
    caller.id = null;
    expect((await classesRoute.GET(get("http://t/api/classes"))).status).toBe(401);
    expect((await classesRoute.POST(post("http://t/api/classes", { name: "x" }))).status).toBe(401);
  });
});

describe("wrapper gates", () => {
  it("cross-origin POST -> 403; bad create body -> 400", async () => {
    expect((await classesRoute.POST(crossOrigin("http://t/api/classes", "POST", { name: "x" }))).status).toBe(403);
    expect((await classesRoute.POST(post("http://t/api/classes", {}))).status).toBe(400);
    expect((await classesRoute.POST(post("http://t/api/classes", { name: "x".repeat(81) }))).status).toBe(400);
    expect((await classesRoute.POST(post("http://t/api/classes", { name: "ok", nope: 1 }))).status).toBe(400);
  });
});

describe("create + list + detail", () => {
  it("creating a class makes the caller a teacher; it shows in teaching", async () => {
    const res = await classesRoute.POST(post("http://t/api/classes", { name: "B2 Morning", emoji: "📘" }));
    expect(res.status).toBe(200);
    const { class: cls } = await json(res);
    expect(cls.created_by).toBe("teacher-a");

    const list = await json(await classesRoute.GET(get("http://t/api/classes")));
    expect(list.teaching.map((c: { id: string }) => c.id)).toContain(cls.id);
    expect(list.enrolled).toEqual([]);
    expect(list.invites).toEqual([]);
  });

  it("detail is member-gated: a non-member gets 404 (no existence leak)", async () => {
    const { id } = await makeClass();
    const mine = await byId.GET(get(`http://t/api/classes/${id}`), ctx(id));
    expect(mine.status).toBe(200);
    expect((await json(mine)).role).toBe("teacher");

    caller.id = "stranger";
    const notMine = await byId.GET(get(`http://t/api/classes/${id}`), ctx(id));
    expect(notMine.status).toBe(404);
  });
});

describe("teacher-only routes reject non-teachers", () => {
  it("PATCH / join-code / roster / remove / archive -> 403 for a student", async () => {
    const { id, code } = await makeClass();
    // A second user joins as a student.
    caller.id = "student-1";
    await join.POST(post("http://t/api/classes/join", { code }));

    // Now the student tries teacher actions.
    expect((await byId.PATCH(patch(`http://t/api/classes/${id}`, { name: "hijack" }), ctx(id))).status).toBe(403);
    expect((await joinCode.POST(post(`http://t/api/classes/${id}/join-code`), ctx(id))).status).toBe(403);
    expect((await joinCode.DELETE(del(`http://t/api/classes/${id}/join-code`), ctx(id))).status).toBe(403);
    expect((await students.GET(get(`http://t/api/classes/${id}/students`), ctx(id))).status).toBe(403);
    expect(
      (await studentById.DELETE(del(`http://t/api/classes/${id}/students/whoever`), ctx2(id, "whoever"))).status,
    ).toBe(403);
    // Archive is creator-only -> the student is forbidden.
    expect((await byId.DELETE(del(`http://t/api/classes/${id}`), ctx(id))).status).toBe(403);
  });
});

describe("join by code: preview, consent write, idempotency", () => {
  it("preview returns the class + teacher without writing; bad code -> 404", async () => {
    const { code } = await makeClass("Prep");
    caller.id = "student-2";
    const preview = await join.GET(get(`http://t/api/classes/join?code=${code}`));
    expect(preview.status).toBe(200);
    const body = await json(preview);
    expect(body.class.name).toBe("Prep");
    expect(typeof body.consent).toBe("string");
    // Preview did NOT enrol the student.
    const list = await json(await classesRoute.GET(get("http://t/api/classes")));
    expect(list.enrolled).toEqual([]);

    expect((await join.GET(get("http://t/api/classes/join?code=NOPENOPE"))).status).toBe(404);
  });

  it("joining enrols the student and appears on the roster; re-join is benign", async () => {
    caller.id = "teacher-b";
    const { id, code } = await makeClass("Roster class");

    caller.id = "student-3";
    const j1 = await join.POST(post("http://t/api/classes/join", { code }));
    expect(j1.status).toBe(200);
    expect((await json(j1)).status).toBe("joined");

    // Idempotent: a second join is benign (already-member), not a duplicate.
    const j2 = await join.POST(post("http://t/api/classes/join", { code }));
    expect(j2.status).toBe(200);
    expect((await json(j2)).status).toBe("already");

    // The teacher sees exactly one roster row.
    caller.id = "teacher-b";
    const roster = await json(await students.GET(get(`http://t/api/classes/${id}/students`), ctx(id)));
    expect(roster.students).toHaveLength(1);
    expect(roster.students[0].user_id).toBe("student-3");
  });

  it("a disabled join code stops working (404)", async () => {
    const { id, code } = await makeClass("Closable");
    await joinCode.DELETE(del(`http://t/api/classes/${id}/join-code`), ctx(id));
    caller.id = "student-x";
    expect((await join.POST(post("http://t/api/classes/join", { code }))).status).toBe(404);
  });
});

describe("caps: the last seat is a 409", () => {
  it("a full class rejects the next joiner with 409", async () => {
    process.env.CLASS_MAX_STUDENTS = "1";
    caller.id = "teacher-cap";
    const { code } = await makeClass("One seat");

    caller.id = "seat-taker";
    expect((await join.POST(post("http://t/api/classes/join", { code }))).status).toBe(200);

    caller.id = "too-late";
    const full = await join.POST(post("http://t/api/classes/join", { code }));
    expect(full.status).toBe(409);
    expect((await json(full)).error).toMatch(/full/i);
    delete process.env.CLASS_MAX_STUDENTS;
  });

  it("the classes-per-teacher cap rejects an extra class with 409", async () => {
    process.env.CLASS_MAX_CLASSES_PER_TEACHER = "1";
    caller.id = "one-class-teacher";
    expect((await classesRoute.POST(post("http://t/api/classes", { name: "First" }))).status).toBe(200);
    const second = await classesRoute.POST(post("http://t/api/classes", { name: "Second" }));
    expect(second.status).toBe(409);
    delete process.env.CLASS_MAX_CLASSES_PER_TEACHER;
  });
});

describe("leave + remove revoke membership", () => {
  it("a student can leave; a teacher can remove a student; archive soft-deletes", async () => {
    caller.id = "teacher-c";
    const { id, code } = await makeClass("Comings and goings");

    // student-4 joins then leaves.
    caller.id = "student-4";
    await join.POST(post("http://t/api/classes/join", { code }));
    expect((await leave.POST(post(`http://t/api/classes/${id}/leave`), ctx(id))).status).toBe(200);
    caller.id = "teacher-c";
    let roster = await json(await students.GET(get(`http://t/api/classes/${id}/students`), ctx(id)));
    expect(roster.students).toHaveLength(0);

    // student-5 joins; the teacher removes them.
    caller.id = "student-5";
    await join.POST(post("http://t/api/classes/join", { code }));
    caller.id = "teacher-c";
    expect(
      (await studentById.DELETE(del(`http://t/api/classes/${id}/students/student-5`), ctx2(id, "student-5"))).status,
    ).toBe(200);
    roster = await json(await students.GET(get(`http://t/api/classes/${id}/students`), ctx(id)));
    expect(roster.students).toHaveLength(0);

    // Archive: the class leaves the teaching list and its code stops working.
    expect((await byId.DELETE(del(`http://t/api/classes/${id}`), ctx(id))).status).toBe(200);
    const list = await json(await classesRoute.GET(get("http://t/api/classes")));
    expect(list.teaching.map((c: { id: string }) => c.id)).not.toContain(id);
    caller.id = "late-joiner";
    expect((await join.POST(post("http://t/api/classes/join", { code }))).status).toBe(404);
  });
});

/*
 * Route 17 — the trust-critical seam. It is the ONLY place forUser() runs with an
 * id other than the caller's, so its authorization (teachesStudent, nothing
 * looser) gets a thorough adversarial test: every unauthorized shape must 404
 * (never leak existence, never 200), and only the actual teacher-of-this-student
 * gets the union payload.
 */
describe("route 17: teacher reads a student's report (authz seam)", () => {
  const reportCtx = (id: string, studentId: string) => ({ params: Promise.resolve({ id, studentId }) });

  async function setup() {
    // teacher-r owns class R; student-r is enrolled in it.
    caller.id = "teacher-r";
    const { id, code } = await makeClass("Report class");
    caller.id = "student-r";
    await join.POST(post("http://t/api/classes/join", { code }));
    return { id, code };
  }

  it("the teacher of THIS class + THAT student -> 200 with the union payload", async () => {
    const { id } = await setup();
    caller.id = "teacher-r";
    const res = await studentReport.GET(get(`http://t/api/classes/${id}/students/student-r/report`), reportCtx(id, "student-r"));
    expect(res.status).toBe(200);
    const body = await json(res);
    // Union of the /api/stats and /api/writing/stats shapes + the student name.
    expect(typeof body.vocab.words.total).toBe("number");
    expect(body.vocab.attempts.byDay).toHaveLength(14);
    expect(typeof body.writing.submissions).toBe("number");
    expect(body.student).toHaveProperty("name");
    // Trust-critical GET: never a cacheable response.
    expect(res.headers.get("cache-control")).toMatch(/no-store/);
  });

  it("a non-member of the class -> 404 (no existence leak)", async () => {
    const { id } = await setup();
    caller.id = "stranger-r";
    const res = await studentReport.GET(get(`http://t/api/classes/${id}/students/student-r/report`), reportCtx(id, "student-r"));
    expect(res.status).toBe(404);
  });

  it("a teacher of a DIFFERENT class -> 404 (teaching *some* class grants nothing)", async () => {
    const { id } = await setup();
    // other-teacher teaches their own class, and student-r is NOT in it.
    caller.id = "other-teacher";
    await makeClass("Unrelated class");
    const res = await studentReport.GET(get(`http://t/api/classes/${id}/students/student-r/report`), reportCtx(id, "student-r"));
    expect(res.status).toBe(404);
  });

  it("a student (a non-teacher member) -> 404, even reading their own report", async () => {
    const { id } = await setup();
    caller.id = "student-r";
    // The student is a member but not a teacher: no teacher row -> 404.
    const own = await studentReport.GET(get(`http://t/api/classes/${id}/students/student-r/report`), reportCtx(id, "student-r"));
    expect(own.status).toBe(404);
    // And a classmate cannot read a peer either.
    caller.id = "student-peer";
    await join.POST(post("http://t/api/classes/join", { code: (await peerCode(id)) }));
    const peer = await studentReport.GET(get(`http://t/api/classes/${id}/students/student-r/report`), reportCtx(id, "student-r"));
    expect(peer.status).toBe(404);
  });

  it("target isn't a student in this class -> 404 (teacher can't name an arbitrary user)", async () => {
    const { id } = await setup();
    caller.id = "teacher-r";
    const res = await studentReport.GET(get(`http://t/api/classes/${id}/students/nobody/report`), reportCtx(id, "nobody"));
    expect(res.status).toBe(404);
  });

  it("after the student leaves, the teacher's next report request 404s (live revocation)", async () => {
    const { id } = await setup();
    caller.id = "student-r";
    await leave.POST(post(`http://t/api/classes/${id}/leave`), ctx(id));
    caller.id = "teacher-r";
    const res = await studentReport.GET(get(`http://t/api/classes/${id}/students/student-r/report`), reportCtx(id, "student-r"));
    expect(res.status).toBe(404);
  });
});

/** Fetch the active join code of a class the current caller teaches. */
async function peerCode(id: string): Promise<string> {
  const prev = caller.id;
  caller.id = "teacher-r";
  const detail = await json(await byId.GET(get(`http://t/api/classes/${id}`), ctx(id)));
  caller.id = prev;
  return detail.class.join_code as string;
}
