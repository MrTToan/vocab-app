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

// Slice 3.1 — invites are emailed via Resend. Mock the email module so no real
// send happens; `email.impl` lets a test simulate the send outcome (default:
// `skipped`, i.e. RESEND_API_KEY unset), and `email.sentTo` records addresses.
type EmailOutcome = { status: "sent"; id?: string } | { status: "skipped" } | { status: "error"; error: string };
const email = vi.hoisted(() => ({
  sentTo: [] as string[],
  impl: (async () => ({ status: "skipped" })) as (p: { to: string }) => Promise<EmailOutcome>,
}));
vi.mock("@/lib/email/invite", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/email/invite")>();
  return {
    ...real,
    sendInviteEmail: (p: { to: string }) => {
      email.sentTo.push(p.to);
      return email.impl(p);
    },
  };
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
let invitesRoute: typeof import("@/app/api/classes/[id]/invites/route");
let inviteById: typeof import("@/app/api/classes/[id]/invites/[inviteId]/route");
let myInvites: typeof import("@/app/api/classes/invites/route");
let acceptInvite: typeof import("@/app/api/classes/invites/[inviteId]/accept/route");
let declineInvite: typeof import("@/app/api/classes/invites/[inviteId]/decline/route");

// ctx builders for the invite routes (Slice 3).
const inviteCtx = (id: string, inviteId: string) => ({ params: Promise.resolve({ id, inviteId }) });
const acceptCtx = (inviteId: string) => ({ params: Promise.resolve({ inviteId }) });

async function json(res: Response) {
  return res.json();
}

/** Seed a users row so getUserEmail (the invite email-match authz) resolves. */
async function seedUser(id: string, email: string) {
  const { getDb } = await import("@/lib/db");
  const db = await getDb();
  await db.execute({
    sql: "INSERT OR REPLACE INTO users (id, email, name, image, created_at) VALUES (?,?,?,?,?)",
    args: [id, email.trim().toLowerCase(), email.split("@")[0], null, Date.now()],
  });
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
  invitesRoute = await import("@/app/api/classes/[id]/invites/route");
  inviteById = await import("@/app/api/classes/[id]/invites/[inviteId]/route");
  myInvites = await import("@/app/api/classes/invites/route");
  acceptInvite = await import("@/app/api/classes/invites/[inviteId]/accept/route");
  declineInvite = await import("@/app/api/classes/invites/[inviteId]/decline/route");
});

beforeEach(() => {
  caller.id = "teacher-a";
  email.sentTo = [];
  email.impl = async () => ({ status: "skipped" });
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

/*
 * Slice 3 — email invites (invite-by-link). Idempotency, the accept seat-guard
 * (last-seat race → exactly one wins), email-match authorization on accept/
 * decline (a wrong email never touches an invite), and teacher-only create/
 * revoke. No real email is sent; the routes only mint tokenised accept links.
 */
describe("invites: create is teacher-only + idempotent", () => {
  it("a non-teacher cannot create or revoke invites (403)", async () => {
    const { id, code } = await makeClass("Invite class");
    caller.id = "student-i";
    await join.POST(post("http://t/api/classes/join", { code }));
    expect(
      (await invitesRoute.POST(post(`http://t/api/classes/${id}/invites`, { emails: ["x@y.com"] }), ctx(id))).status,
    ).toBe(403);
    expect(
      (await inviteById.DELETE(del(`http://t/api/classes/${id}/invites/whatever`), inviteCtx(id, "whatever"))).status,
    ).toBe(403);
  });

  it("re-inviting the same email updates the row, never duplicates", async () => {
    caller.id = "teacher-i2";
    const { id } = await makeClass("Idempotent invites");

    const first = await invitesRoute.POST(post(`http://t/api/classes/${id}/invites`, { emails: ["Dup@X.com"] }), ctx(id));
    expect(first.status).toBe(200);
    const firstBody = await json(first);
    expect(firstBody.invites).toHaveLength(1);
    // The email is normalized (trim + lowercase) and an accept link is returned.
    expect(firstBody.invites[0].email).toBe("dup@x.com");
    expect(firstBody.invites[0].acceptLink).toMatch(/\/classes\?invite=/);
    const firstId = firstBody.invites[0].id;

    // Re-invite the same address (different case / spacing) — must update, not add.
    const second = await invitesRoute.POST(post(`http://t/api/classes/${id}/invites`, { emails: ["  dup@x.com "] }), ctx(id));
    const secondBody = await json(second);
    expect(secondBody.invites[0].id).toBe(firstId); // same row id

    // Exactly one pending invite on the class detail.
    const detail = await json(await byId.GET(get(`http://t/api/classes/${id}`), ctx(id)));
    expect(detail.invites).toHaveLength(1);
    expect(detail.invites[0].email).toBe("dup@x.com");

    // Non-email entries are dropped rather than failing the batch.
    const mixed = await invitesRoute.POST(
      post(`http://t/api/classes/${id}/invites`, { emails: ["not-an-email", "ok@z.com"] }),
      ctx(id),
    );
    const mixedBody = await json(mixed);
    expect(mixedBody.invites.map((i: { email: string }) => i.email)).toEqual(["ok@z.com"]);
  });

  it("builds the accept link from the proxy-forwarded public host, not the internal request origin", async () => {
    caller.id = "teacher-i3";
    const { id } = await makeClass("Forwarded-host invites");
    // Simulate the reverse proxy (Caddy) forwarding the real public host while
    // the request itself arrives on the internal localhost address.
    const res = await invitesRoute.POST(
      post(`http://localhost:3000/api/classes/${id}/invites`, { emails: ["proxy@x.com"] }, {
        "x-forwarded-host": "lexi.vnfriends.com",
        "x-forwarded-proto": "https",
      }),
      ctx(id),
    );
    const body = await json(res);
    expect(body.invites[0].acceptLink).toMatch(/^https:\/\/lexi\.vnfriends\.com\/classes\?invite=/);
    expect(body.invites[0].acceptLink).not.toContain("localhost");
  });
});

describe("invites: emailing is best-effort and never fails creation", () => {
  it("sends one email per newly-created address and marks them emailed", async () => {
    email.impl = async () => ({ status: "sent", id: "e1" });
    caller.id = "teacher-em1";
    const { id } = await makeClass("Emailed class");
    const res = await invitesRoute.POST(
      post(`http://t/api/classes/${id}/invites`, { emails: ["one@x.com", "two@x.com"] }),
      ctx(id),
    );
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(email.sentTo.sort()).toEqual(["one@x.com", "two@x.com"]);
    expect(body.invites.every((i: { emailed: boolean }) => i.emailed)).toBe(true);
    expect(body.warning).toBeUndefined();
  });

  it("still creates invites + returns links when email is unconfigured (skipped)", async () => {
    // Default impl is `skipped` (RESEND_API_KEY unset).
    caller.id = "teacher-em2";
    const { id } = await makeClass("No-key class");
    const res = await invitesRoute.POST(
      post(`http://t/api/classes/${id}/invites`, { emails: ["nokey@x.com"] }),
      ctx(id),
    );
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(email.sentTo).toEqual(["nokey@x.com"]);
    expect(body.invites[0].acceptLink).toMatch(/\/classes\?invite=/);
    expect(body.invites[0].emailed).toBe(false);
    expect(body.warning).toBeUndefined(); // no key is not a failure — no warning
  });

  it("never 500s when a send errors; warns + emailed:false, link still returned", async () => {
    email.impl = async () => ({ status: "error", error: "domain not verified" });
    caller.id = "teacher-em3";
    const { id } = await makeClass("Send-fails class");
    const res = await invitesRoute.POST(
      post(`http://t/api/classes/${id}/invites`, { emails: ["fail@x.com"] }),
      ctx(id),
    );
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.invites[0].emailed).toBe(false);
    expect(body.invites[0].acceptLink).toMatch(/\/classes\?invite=/);
    expect(body.warning).toMatch(/couldn't email/i);
  });

  it("does not re-email an already-accepted invite (no spam on re-invite)", async () => {
    email.impl = async () => ({ status: "sent" });
    caller.id = "teacher-em4";
    const invitee = "accepted-invitee";
    const inviteeEmail = "accepted@x.com";
    const { id } = await makeClass("Accepted class");
    await seedUser(invitee, inviteeEmail);
    const first = await invitesRoute.POST(
      post(`http://t/api/classes/${id}/invites`, { emails: [inviteeEmail] }),
      ctx(id),
    );
    const inviteId = (await json(first)).invites[0].id as string;
    // Student accepts (consent) → membership row.
    caller.id = invitee;
    await acceptInvite.POST(post(`http://t/api/classes/invites/${inviteId}/accept`), acceptCtx(inviteId));
    // Teacher re-invites the same, now-accepted address: must not email again.
    caller.id = "teacher-em4";
    email.sentTo = [];
    const again = await invitesRoute.POST(
      post(`http://t/api/classes/${id}/invites`, { emails: [inviteeEmail] }),
      ctx(id),
    );
    const body = await json(again);
    expect(body.invites[0].status).toBe("accepted");
    expect(email.sentTo).toEqual([]);
  });
});

describe("invites: the banner, accept, decline (email-matched)", () => {
  // The file shares ONE DB across tests (only caller.id resets), so each test
  // uses a UNIQUE invitee id+email to stay isolated from the others' invites.
  let n = 0;
  async function setup(className = "Banner class") {
    n += 1;
    const invitee = `invitee-${n}`;
    const email = `invitee${n}@school.edu`;
    caller.id = "teacher-b3";
    const { id } = await makeClass(className);
    await seedUser(invitee, email);
    const res = await invitesRoute.POST(post(`http://t/api/classes/${id}/invites`, { emails: [email] }), ctx(id));
    const { invites } = await json(res);
    return { id, invitee, email, inviteId: invites[0].id as string };
  }

  it("GET /api/classes/invites lists pending invites for the caller's email", async () => {
    const { id, invitee } = await setup();
    caller.id = invitee;
    const res = await myInvites.GET(get("http://t/api/classes/invites"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toMatch(/no-store/);
    const body = await json(res);
    expect(body.invites).toHaveLength(1);
    expect(body.invites[0].class.id).toBe(id);
    expect(body.invites[0].teacher.name).toBeTruthy();
    // A different account sees none of THIS invitee's invites.
    caller.id = "someone-else";
    await seedUser("someone-else", "other-unique@school.edu");
    expect((await json(await myInvites.GET(get("http://t/api/classes/invites")))).invites).toHaveLength(0);
  });

  it("accepting seats the student (joined_via='invite') and marks the invite done", async () => {
    const { id, invitee, inviteId } = await setup("Accept class");
    caller.id = invitee;
    const res = await acceptInvite.POST(post(`http://t/api/classes/invites/${inviteId}/accept`), acceptCtx(inviteId));
    expect(res.status).toBe(200);
    expect((await json(res)).status).toBe("joined");

    // On the roster, via invite; the invite no longer shows as pending.
    caller.id = "teacher-b3";
    const roster = await json(await students.GET(get(`http://t/api/classes/${id}/students`), ctx(id)));
    expect(roster.students).toHaveLength(1);
    expect(roster.students[0].user_id).toBe(invitee);
    expect(roster.students[0].joined_via).toBe("invite");
    const detail = await json(await byId.GET(get(`http://t/api/classes/${id}`), ctx(id)));
    expect(detail.invites).toHaveLength(0);

    // The banner is now empty for the invitee.
    caller.id = invitee;
    expect((await json(await myInvites.GET(get("http://t/api/classes/invites")))).invites).toHaveLength(0);
  });

  it("accept/decline require the caller's email to match the invite (else 404)", async () => {
    const { inviteId } = await setup("Authz class");
    // A signed-in user with a DIFFERENT email cannot accept or decline it.
    caller.id = "wrong-person";
    await seedUser("wrong-person", "wrong@school.edu");
    expect((await acceptInvite.POST(post(`http://t/api/classes/invites/${inviteId}/accept`), acceptCtx(inviteId))).status).toBe(404);
    expect((await declineInvite.POST(post(`http://t/api/classes/invites/${inviteId}/decline`), acceptCtx(inviteId))).status).toBe(404);
    // A user with no users row (no resolvable email) also 404s.
    caller.id = "emailless";
    expect((await acceptInvite.POST(post(`http://t/api/classes/invites/${inviteId}/accept`), acceptCtx(inviteId))).status).toBe(404);
  });

  it("declining marks the invite declined and creates no membership", async () => {
    const { id, invitee, inviteId } = await setup("Decline class");
    caller.id = invitee;
    expect((await declineInvite.POST(post(`http://t/api/classes/invites/${inviteId}/decline`), acceptCtx(inviteId))).status).toBe(200);
    expect((await json(await myInvites.GET(get("http://t/api/classes/invites")))).invites).toHaveLength(0);
    caller.id = "teacher-b3";
    const roster = await json(await students.GET(get(`http://t/api/classes/${id}/students`), ctx(id)));
    expect(roster.students).toHaveLength(0);
  });

  it("a revoked invite can no longer be accepted (404)", async () => {
    const { id, invitee, inviteId } = await setup("Revoke class");
    caller.id = "teacher-b3";
    expect((await inviteById.DELETE(del(`http://t/api/classes/${id}/invites/${inviteId}`), inviteCtx(id, inviteId))).status).toBe(200);
    // Pending list is now empty for the teacher and the invitee.
    const detail = await json(await byId.GET(get(`http://t/api/classes/${id}`), ctx(id)));
    expect(detail.invites).toHaveLength(0);
    caller.id = invitee;
    expect((await json(await myInvites.GET(get("http://t/api/classes/invites")))).invites).toHaveLength(0);
    // The revoked invite is no longer actionable: accept 404s even though the
    // caller's email still matches (a dead link cannot resurrect a seat).
    const res = await acceptInvite.POST(post(`http://t/api/classes/invites/${inviteId}/accept`), acceptCtx(inviteId));
    expect(res.status).toBe(404);
  });
});

describe("invites: the accept seat-guard (last-seat race)", () => {
  it("two invited students race for the last seat — one joins, the other 409s", async () => {
    process.env.CLASS_MAX_STUDENTS = "1";
    caller.id = "teacher-seat";
    const { id } = await makeClass("One invite seat");
    await seedUser("racer-1", "racer1@x.com");
    await seedUser("racer-2", "racer2@x.com");
    const res = await invitesRoute.POST(
      post(`http://t/api/classes/${id}/invites`, { emails: ["racer1@x.com", "racer2@x.com"] }),
      ctx(id),
    );
    const { invites, warning } = await json(res);
    // Two pending + zero students still fits (1 seat, warned only when > cap).
    expect(invites).toHaveLength(2);
    const byEmail = Object.fromEntries(invites.map((i: { email: string; id: string }) => [i.email, i.id]));

    caller.id = "racer-1";
    expect((await acceptInvite.POST(post(`http://t/api/classes/invites/${byEmail["racer1@x.com"]}/accept`), acceptCtx(byEmail["racer1@x.com"]))).status).toBe(200);
    caller.id = "racer-2";
    const full = await acceptInvite.POST(post(`http://t/api/classes/invites/${byEmail["racer2@x.com"]}/accept`), acceptCtx(byEmail["racer2@x.com"]));
    expect(full.status).toBe(409);
    expect((await json(full)).error).toMatch(/full/i);
    // The loser's invite stays pending, so a freed seat lets them retry later.
    caller.id = "racer-2";
    expect((await json(await myInvites.GET(get("http://t/api/classes/invites")))).invites).toHaveLength(1);

    void warning;
    delete process.env.CLASS_MAX_STUDENTS;
  });

  it("warns (does not block) when pending + students would exceed the cap", async () => {
    process.env.CLASS_MAX_STUDENTS = "1";
    caller.id = "teacher-warn";
    const { id } = await makeClass("Warn class");
    const res = await invitesRoute.POST(
      post(`http://t/api/classes/${id}/invites`, { emails: ["a@x.com", "b@x.com"] }),
      ctx(id),
    );
    const body = await json(res);
    expect(res.status).toBe(200);
    expect(body.invites).toHaveLength(2); // created despite the cap
    expect(body.warning).toMatch(/limit/i);
    delete process.env.CLASS_MAX_STUDENTS;
  });
});
