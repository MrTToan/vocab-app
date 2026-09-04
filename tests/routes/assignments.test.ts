import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { get, post, patch, del, crossOrigin } from "./kit";

/*
 * Route + store coverage for the Assignments feature (Slice 1, vocab collections).
 * Real temp SQLite. `currentUserId` swaps between the teacher, targeted/untargeted
 * students and a stranger to exercise: teacher-only create (403 else), specific-
 * student targeting, the private-content VISIBILITY GRANT (a targeted student can
 * practise a private collection) and its revocation (archive / remove / class
 * archive), completion derivation from attempts ("practised at least once"), and
 * live overdue.
 */

const caller = vi.hoisted(() => ({ id: "teacher-a" as string | null }));
vi.mock("@/lib/auth/user", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/auth/user")>();
  return { ...real, currentUserId: async () => caller.id };
});

// ctx builders.
const cctx = (id: string) => ({ params: Promise.resolve({ id }) }); // class id param
const actx = (assignmentId: string) => ({ params: Promise.resolve({ assignmentId }) });
const rmctx = (id: string, studentId: string) => ({ params: Promise.resolve({ id, studentId }) });

let classesRoute: typeof import("@/app/api/classes/route");
let joinCodeRoute: typeof import("@/app/api/classes/[id]/join-code/route");
let joinRoute: typeof import("@/app/api/classes/join/route");
let byIdRoute: typeof import("@/app/api/classes/[id]/route");
let studentByIdRoute: typeof import("@/app/api/classes/[id]/students/[studentId]/route");
let classAssignments: typeof import("@/app/api/classes/[id]/assignments/route");
let myAssignments: typeof import("@/app/api/assignments/route");
let assignmentById: typeof import("@/app/api/assignments/[assignmentId]/route");
let contentRoute: typeof import("@/app/api/assignments/content/route");
let kindsRoute: typeof import("@/app/api/assignments/kinds/route");

const json = (res: Response) => res.json();

/** Seed a collection + its member words directly (bypasses the add flow). */
async function seedCollection(
  collectionId: string,
  ownerId: string,
  visibility: "public" | "private",
  wordIds: string[],
) {
  const { getDb } = await import("@/lib/db");
  const db = await getDb();
  await db.execute({
    sql: "INSERT OR REPLACE INTO collections (id, name, description, emoji, created_at, owner_id, visibility) VALUES (?,?,?,?,?,?,?)",
    args: [collectionId, `Set ${collectionId}`, "", "📗", Date.now(), ownerId, visibility],
  });
  for (const wid of wordIds) {
    await db.execute({
      sql: "INSERT OR REPLACE INTO words (id, word, owner_id, created_at) VALUES (?,?,?,?)",
      args: [wid, `word-${wid}`, "__system__", Date.now()],
    });
    await db.execute({
      sql: "INSERT OR IGNORE INTO word_collections (word_id, collection_id) VALUES (?,?)",
      args: [wid, collectionId],
    });
  }
}

/** Seed a public writing prompt directly (the bank is admin-curated + public). */
async function seedWritingPrompt(
  id: string,
  task: "task1" | "task2",
  title: string,
  visibility: "public" | "private" = "public",
) {
  const { getDb } = await import("@/lib/db");
  const db = await getDb();
  await db.execute({
    sql: `INSERT OR REPLACE INTO writing_prompts
            (id, task_type, title, prompt_text, tags, last_shown, created_at, user_id, owner_id, visibility)
          VALUES (?,?,?,?,?,0,?,?,?,?)`,
    args: [id, task, title, `Body of ${title}`, "[]", Date.now(), "__system__", "__system__", visibility],
  });
}

/** Seed a stored writing submission for a user (drives writing completion). */
async function seedWritingSubmission(userId: string, promptId: string) {
  const { getDb } = await import("@/lib/db");
  const db = await getDb();
  await db.execute({
    sql: `INSERT INTO writing_submissions
            (id, prompt_id, task_type, text, word_count, overall_band, bands, strengths, general_feedback, priorities, created_at, user_id)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    args: [
      `sub-${userId}-${promptId}-${Math.random()}`, promptId, "task2", "essay", 260, 7,
      "{}", "[]", "", "[]", Date.now(), userId,
    ],
  });
}

/** Log a practice attempt for a user on a word (drives completion). */
async function logAttempt(userId: string, wordId: string) {
  const { getStore } = await import("@/lib/store");
  await getStore()
    .forUser(userId)
    .logAttempt({ ts: Date.now(), word_id: wordId, exercise_type: "cloze", result: "correct" });
}

/** How many candidate words a user can practise in a collection (visibility gate). */
async function practiceCount(userId: string, collectionId: string) {
  const { getStore } = await import("@/lib/store");
  return (await getStore().forUser(userId).practiceCandidatesLite(collectionId)).length;
}

beforeAll(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "lexi-assign-"));
  process.env.DATABASE_URL = `file:${path.join(dir, "t.db")}`;
  delete process.env.DATABASE_AUTH_TOKEN;
  delete process.env.SHEET_ID;
  delete process.env.AUTH_SECRET;
  delete process.env.AUTH_GOOGLE_ID;
  delete process.env.CLASS_MAX_STUDENTS;
  delete process.env.ASSIGNMENT_MAX_PER_CLASS;
  classesRoute = await import("@/app/api/classes/route");
  joinCodeRoute = await import("@/app/api/classes/[id]/join-code/route");
  joinRoute = await import("@/app/api/classes/join/route");
  byIdRoute = await import("@/app/api/classes/[id]/route");
  studentByIdRoute = await import("@/app/api/classes/[id]/students/[studentId]/route");
  classAssignments = await import("@/app/api/classes/[id]/assignments/route");
  myAssignments = await import("@/app/api/assignments/route");
  assignmentById = await import("@/app/api/assignments/[assignmentId]/route");
  contentRoute = await import("@/app/api/assignments/content/route");
  kindsRoute = await import("@/app/api/assignments/kinds/route");

  // A shared public catalog pack (assignable by anyone).
  await seedCollection("pubcol-col-test", "__system__", "public", ["pw1", "pw2", "pw3", "pw4"]);
  // A shared public writing prompt (Slice 2's writing_prompt kind).
  await seedWritingPrompt("pub-wp-test", "task2", "Public writing prompt");
});

beforeEach(() => {
  caller.id = "teacher-a";
});

/** Create a class (as the current caller) + a join code; join `students` to it. */
async function makeClassWith(teacher: string, students: string[], name = "Class") {
  caller.id = teacher;
  const { class: cls } = await json(await classesRoute.POST(post("http://t/api/classes", { name })));
  const { join_code } = await json(
    await joinCodeRoute.POST(post(`http://t/api/classes/${cls.id}/join-code`), cctx(cls.id)),
  );
  for (const s of students) {
    caller.id = s;
    await joinRoute.POST(post("http://t/api/classes/join", { code: join_code }));
  }
  caller.id = teacher;
  return { id: cls.id as string, code: join_code as string };
}

/** Create a vocab-collection assignment (as the current caller). */
async function createAssignment(
  classId: string,
  ref: string,
  studentIds: string[],
  extra: Record<string, unknown> = {},
) {
  return classAssignments.POST(
    post(`http://t/api/classes/${classId}/assignments`, {
      kind: "vocab_collection",
      ref,
      studentIds,
      ...extra,
    }),
    cctx(classId),
  );
}

/** Create a writing-prompt assignment (as the current caller). */
async function createWritingAssignment(
  classId: string,
  ref: string,
  studentIds: string[],
  extra: Record<string, unknown> = {},
) {
  return classAssignments.POST(
    post(`http://t/api/classes/${classId}/assignments`, {
      kind: "writing_prompt",
      ref,
      studentIds,
      ...extra,
    }),
    cctx(classId),
  );
}

describe("wrapper + kinds/content", () => {
  it("signed out → 401; cross-origin create → 403", async () => {
    caller.id = null;
    expect((await myAssignments.GET(get("http://t/api/assignments"))).status).toBe(401);
    caller.id = "teacher-a";
    expect(
      (await classAssignments.POST(crossOrigin("http://t/api/classes/x/assignments", "POST", {}), cctx("x")))
        .status,
    ).toBe(403);
  });

  it("GET /api/assignments/kinds is registry-driven (vocab in Slice 1)", async () => {
    const body = await json(await kindsRoute.GET(get("http://t/api/assignments/kinds")));
    expect(body.kinds.map((k: { kind: string }) => k.kind)).toContain("vocab_collection");
  });

  it("GET /api/assignments/content?kind= lists the caller's own + public sets", async () => {
    // A private set owned by this teacher + the shared public pack.
    await seedCollection("priv-content-a", "content-teacher", "private", ["cw1", "cw2"]);
    caller.id = "content-teacher";
    const body = await json(
      await contentRoute.GET(get("http://t/api/assignments/content?kind=vocab_collection")),
    );
    const refs = body.content.map((c: { ref: string }) => c.ref);
    expect(refs).toContain("priv-content-a"); // own private
    expect(refs).toContain("pubcol-col-test"); // public
  });
});

describe("create: teacher-only + input validation", () => {
  it("a teacher assigns a public set to specific students (200)", async () => {
    const { id } = await makeClassWith("t-create", ["s1", "s2", "s3"]);
    const res = await createAssignment(id, "pubcol-col-test", ["s1", "s2"]);
    expect(res.status).toBe(200);
    const { assignment } = await json(res);
    expect(assignment.content_kind).toBe("vocab_collection");
    expect(assignment.content_ref).toBe("pubcol-col-test");

    // The teacher list shows it with the resolved card + 2 targets.
    const list = await json(await classAssignments.GET(get(`http://t/api/classes/${id}/assignments`), cctx(id)));
    expect(list.role).toBe("teacher");
    expect(list.assignments).toHaveLength(1);
    expect(list.assignments[0].targetCount).toBe(2);
    expect(list.assignments[0].content.available).toBe(true);
  });

  it("a non-teacher (student) cannot create (403)", async () => {
    const { id } = await makeClassWith("t-403", ["s-403"]);
    caller.id = "s-403";
    expect((await createAssignment(id, "pubcol-col-test", ["s-403"])).status).toBe(403);
  });

  it("a non-member cannot create (403)", async () => {
    const { id } = await makeClassWith("t-nm", ["s-nm"]);
    caller.id = "stranger-nm";
    expect((await createAssignment(id, "pubcol-col-test", ["s-nm"])).status).toBe(403);
  });

  it("an unknown/invisible content ref → 400", async () => {
    const { id } = await makeClassWith("t-badref", ["s-b"]);
    expect((await createAssignment(id, "no-such-collection", ["s-b"])).status).toBe(400);
  });

  it("targeting only non-students of the class → 400 (no valid students)", async () => {
    const { id } = await makeClassWith("t-nostud", ["real-s"]);
    // "ghost" is not in the class → filtered out → none left.
    expect((await createAssignment(id, "pubcol-col-test", ["ghost"])).status).toBe(400);
  });

  it("empty studentIds → 400 (zod min 1)", async () => {
    const { id } = await makeClassWith("t-empty", ["s-e"]);
    expect((await createAssignment(id, "pubcol-col-test", [])).status).toBe(400);
  });

  it("the per-class assignment cap is a 409", async () => {
    process.env.ASSIGNMENT_MAX_PER_CLASS = "1";
    const { id } = await makeClassWith("t-cap", ["s-cap"]);
    expect((await createAssignment(id, "pubcol-col-test", ["s-cap"])).status).toBe(200);
    const second = await createAssignment(id, "pubcol-col-test", ["s-cap"]);
    expect(second.status).toBe(409);
    delete process.env.ASSIGNMENT_MAX_PER_CLASS;
  });
});

describe("student experience: only targets see it", () => {
  it("a targeted student sees the assignment; an untargeted classmate does not", async () => {
    const { id } = await makeClassWith("t-see", ["seen", "unseen"]);
    await createAssignment(id, "pubcol-col-test", ["seen"]);

    caller.id = "seen";
    const mine = await json(await myAssignments.GET(get("http://t/api/assignments")));
    expect(mine.assignments).toHaveLength(1);
    expect(mine.assignments[0].content.doHref).toBe("/practice?collection=pubcol-col-test");

    caller.id = "unseen";
    const none = await json(await myAssignments.GET(get("http://t/api/assignments")));
    expect(none.assignments).toHaveLength(0);
  });

  it("class assignments GET is member-gated (non-member → 404)", async () => {
    const { id } = await makeClassWith("t-gate", ["s-gate"]);
    caller.id = "stranger-gate";
    expect((await classAssignments.GET(get(`http://t/api/classes/${id}/assignments`), cctx(id))).status).toBe(404);
  });

  it("assignment detail 404s for a member who isn't a target", async () => {
    const { id } = await makeClassWith("t-det", ["target-d", "other-d"]);
    const { assignment } = await json(await createAssignment(id, "pubcol-col-test", ["target-d"]));
    // The non-targeted member gets a 404 (existence not leaked).
    caller.id = "other-d";
    expect((await assignmentById.GET(get(`http://t/api/assignments/${assignment.id}`), actx(assignment.id))).status).toBe(404);
    // The target sees their own card.
    caller.id = "target-d";
    const detail = await json(await assignmentById.GET(get(`http://t/api/assignments/${assignment.id}`), actx(assignment.id)));
    expect(detail.role).toBe("student");
    expect(detail.assignment.content.ref).toBe("pubcol-col-test");
  });
});

describe("private-content visibility grant + revocation", () => {
  it("a targeted student can practise a PRIVATE set; an untargeted one cannot", async () => {
    await seedCollection("priv-grant", "t-grant", "private", ["gw1", "gw2", "gw3"]);
    const { id } = await makeClassWith("t-grant", ["granted", "ungranted"]);

    // Before any assignment, NEITHER student can see the private set.
    expect(await practiceCount("granted", "priv-grant")).toBe(0);

    await createAssignment(id, "priv-grant", ["granted"]);

    // The grant makes /practice?collection=priv-grant work for the target only.
    expect(await practiceCount("granted", "priv-grant")).toBe(3);
    expect(await practiceCount("ungranted", "priv-grant")).toBe(0);
    // The teacher (owner) always could; a stranger never can.
    expect(await practiceCount("t-grant", "priv-grant")).toBe(3);
    expect(await practiceCount("stranger-g", "priv-grant")).toBe(0);
  });

  it("archiving the assignment revokes the grant", async () => {
    await seedCollection("priv-arch", "t-arch", "private", ["aw1", "aw2"]);
    const { id } = await makeClassWith("t-arch", ["stu-arch"]);
    const { assignment } = await json(await createAssignment(id, "priv-arch", ["stu-arch"]));
    expect(await practiceCount("stu-arch", "priv-arch")).toBe(2);

    caller.id = "t-arch";
    await assignmentById.DELETE(del(`http://t/api/assignments/${assignment.id}`), actx(assignment.id));
    expect(await practiceCount("stu-arch", "priv-arch")).toBe(0); // revoked
  });

  it("removing the student from the class revokes the grant", async () => {
    await seedCollection("priv-rm", "t-rm", "private", ["rw1", "rw2"]);
    const { id } = await makeClassWith("t-rm", ["stu-rm"]);
    await createAssignment(id, "priv-rm", ["stu-rm"]);
    expect(await practiceCount("stu-rm", "priv-rm")).toBe(2);

    caller.id = "t-rm";
    await studentByIdRoute.DELETE(del(`http://t/api/classes/${id}/students/stu-rm`), rmctx(id, "stu-rm"));
    expect(await practiceCount("stu-rm", "priv-rm")).toBe(0); // revoked
  });

  it("archiving the class revokes the grant", async () => {
    await seedCollection("priv-cls", "t-cls", "private", ["cw1", "cw2"]);
    const { id } = await makeClassWith("t-cls", ["stu-cls"]);
    await createAssignment(id, "priv-cls", ["stu-cls"]);
    expect(await practiceCount("stu-cls", "priv-cls")).toBe(2);

    caller.id = "t-cls";
    await byIdRoute.DELETE(del(`http://t/api/classes/${id}`), cctx(id));
    expect(await practiceCount("stu-cls", "priv-cls")).toBe(0); // revoked
  });
});

describe("completion derivation ('practised at least once')", () => {
  it("a student is 'not started' until they log an attempt on a member word", async () => {
    const { id } = await makeClassWith("t-comp", ["comp-s"]);
    const { assignment } = await json(await createAssignment(id, "pubcol-col-test", ["comp-s"]));

    // Before: not started, 0 complete.
    caller.id = "t-comp";
    let detail = await json(await assignmentById.GET(get(`http://t/api/assignments/${assignment.id}`), actx(assignment.id)));
    expect(detail.completeCount).toBe(0);
    expect(detail.students[0].progress.state).toBe("not_started");

    // Practise ONE member word.
    await logAttempt("comp-s", "pw1");

    // After: complete (≥1 attempt), detail shows coverage.
    detail = await json(await assignmentById.GET(get(`http://t/api/assignments/${assignment.id}`), actx(assignment.id)));
    expect(detail.completeCount).toBe(1);
    expect(detail.students[0].progress.state).toBe("complete");
    expect(detail.students[0].progress.detail).toMatch(/Practised 1 \/ 4/);

    // The student's own view agrees.
    caller.id = "comp-s";
    const mine = await json(await myAssignments.GET(get("http://t/api/assignments")));
    expect(mine.assignments[0].progress.state).toBe("complete");
  });
});

describe("writing_prompt kind (Slice 2 — same flow, new adapter)", () => {
  it("kinds registry now includes writing_prompt", async () => {
    const body = await json(await kindsRoute.GET(get("http://t/api/assignments/kinds")));
    const kinds = body.kinds.map((k: { kind: string }) => k.kind);
    expect(kinds).toContain("vocab_collection");
    expect(kinds).toContain("writing_prompt");
  });

  it("the content picker lists public writing prompts (not private drafts)", async () => {
    await seedWritingPrompt("wp-draft", "task2", "A draft", "private");
    const body = await json(
      await contentRoute.GET(get("http://t/api/assignments/content?kind=writing_prompt")),
    );
    const refs = body.content.map((c: { ref: string }) => c.ref);
    expect(refs).toContain("pub-wp-test");
    expect(refs).not.toContain("wp-draft"); // private → not assignable
  });

  it("a teacher assigns a writing prompt to specific students; completion flips after a submission", async () => {
    const { id } = await makeClassWith("t-write", ["w-seen", "w-unseen"]);
    const res = await createWritingAssignment(id, "pub-wp-test", ["w-seen"]);
    expect(res.status).toBe(200);
    const { assignment } = await json(res);
    expect(assignment.content_kind).toBe("writing_prompt");

    // The targeted student sees it, deep-linked into the EXISTING writing flow;
    // the untargeted classmate does not.
    caller.id = "w-seen";
    const mine = await json(await myAssignments.GET(get("http://t/api/assignments")));
    expect(mine.assignments).toHaveLength(1);
    expect(mine.assignments[0].content.doHref).toBe("/writing/task2?q=pub-wp-test");
    expect(mine.assignments[0].progress.state).toBe("not_started");

    caller.id = "w-unseen";
    expect((await json(await myAssignments.GET(get("http://t/api/assignments")))).assignments).toHaveLength(0);

    // Teacher sees not-yet-complete.
    caller.id = "t-write";
    let detail = await json(await assignmentById.GET(get(`http://t/api/assignments/${assignment.id}`), actx(assignment.id)));
    expect(detail.completeCount).toBe(0);
    expect(detail.students[0].progress.state).toBe("not_started");

    // The student submits → completion flips to done (both views).
    await seedWritingSubmission("w-seen", "pub-wp-test");
    caller.id = "t-write";
    detail = await json(await assignmentById.GET(get(`http://t/api/assignments/${assignment.id}`), actx(assignment.id)));
    expect(detail.completeCount).toBe(1);
    expect(detail.students[0].progress.state).toBe("complete");
    expect(detail.students[0].progress.detail).toMatch(/Submitted/);

    caller.id = "w-seen";
    const after = await json(await myAssignments.GET(get("http://t/api/assignments")));
    expect(after.assignments[0].progress.state).toBe("complete");
  });

  it("assigning a private writing draft → 400 (student couldn't open it)", async () => {
    await seedWritingPrompt("wp-draft2", "task2", "Draft two", "private");
    const { id } = await makeClassWith("t-wdraft", ["w-d"]);
    expect((await createWritingAssignment(id, "wp-draft2", ["w-d"])).status).toBe(400);
  });
});

describe("due dates + live overdue", () => {
  it("a past due date with no completion is overdue; a future one is not", async () => {
    const { id } = await makeClassWith("t-due", ["due-late", "due-fine"]);
    const past = Date.now() - 86_400_000;
    const future = Date.now() + 86_400_000;
    await createAssignment(id, "pubcol-col-test", ["due-late"], { dueAt: past });
    await createAssignment(id, "pubcol-col-test", ["due-fine"], { dueAt: future });

    caller.id = "due-late";
    const late = await json(await myAssignments.GET(get("http://t/api/assignments")));
    expect(late.assignments[0].overdue).toBe(true);

    caller.id = "due-fine";
    const fine = await json(await myAssignments.GET(get("http://t/api/assignments")));
    expect(fine.assignments[0].overdue).toBe(false);
  });

  it("completing a past-due assignment clears overdue", async () => {
    const { id } = await makeClassWith("t-due2", ["due-done"]);
    await createAssignment(id, "pubcol-col-test", ["due-done"], { dueAt: Date.now() - 1000 });
    await logAttempt("due-done", "pw2");
    caller.id = "due-done";
    const done = await json(await myAssignments.GET(get("http://t/api/assignments")));
    expect(done.assignments[0].progress.state).toBe("complete");
    expect(done.assignments[0].overdue).toBe(false);
  });
});

describe("edit + archive", () => {
  it("a teacher edits the title/due date; a non-teacher cannot (403)", async () => {
    const { id } = await makeClassWith("t-edit", ["s-ed"]);
    const { assignment } = await json(await createAssignment(id, "pubcol-col-test", ["s-ed"]));

    caller.id = "s-ed";
    expect(
      (await assignmentById.PATCH(patch(`http://t/api/assignments/${assignment.id}`, { title: "hijack" }), actx(assignment.id))).status,
    ).toBe(403);

    caller.id = "t-edit";
    const res = await assignmentById.PATCH(patch(`http://t/api/assignments/${assignment.id}`, { title: "Homework 1" }), actx(assignment.id));
    expect(res.status).toBe(200);
    expect((await json(res)).assignment.title).toBe("Homework 1");
  });

  it("archiving removes it from the class + student lists", async () => {
    const { id } = await makeClassWith("t-arch2", ["s-a2"]);
    const { assignment } = await json(await createAssignment(id, "pubcol-col-test", ["s-a2"]));
    caller.id = "t-arch2";
    expect((await assignmentById.DELETE(del(`http://t/api/assignments/${assignment.id}`), actx(assignment.id))).status).toBe(200);

    const list = await json(await classAssignments.GET(get(`http://t/api/classes/${id}/assignments`), cctx(id)));
    expect(list.assignments).toHaveLength(0);
    caller.id = "s-a2";
    expect((await json(await myAssignments.GET(get("http://t/api/assignments")))).assignments).toHaveLength(0);
  });
});
