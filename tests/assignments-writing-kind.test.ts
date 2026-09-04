import { describe, it, expect, beforeAll } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";

/*
 * Unit coverage for the `writing_prompt` AssignableKind adapter (Slice 2): the
 * three things a kind must provide — (a) list/pick, (b) deep-link into the doing
 * flow, (c) completion = "submitted". Real temp SQLite; the adapter is exercised
 * directly (no routes). See tests/routes/assignments.test.ts for the route path.
 */

let adapter: import("@/lib/assignments/kinds/kind").AssignableKind;

/** Seed a writing prompt row directly. */
async function seedPrompt(
  id: string,
  ownerId: string,
  visibility: "public" | "private",
  task: "task1" | "task2",
  title: string,
) {
  const { getDb } = await import("@/lib/db");
  const db = await getDb();
  await db.execute({
    sql: `INSERT OR REPLACE INTO writing_prompts
            (id, task_type, title, prompt_text, tags, last_shown, created_at, user_id, owner_id, visibility)
          VALUES (?,?,?,?,?,0,?,?,?,?)`,
    args: [id, task, title, `Body of ${title}`, "[]", Date.now(), ownerId, ownerId, visibility],
  });
}

/** Seed a stored submission (drives completion). */
async function seedSubmission(userId: string, promptId: string, band: number) {
  const { getDb } = await import("@/lib/db");
  const db = await getDb();
  await db.execute({
    sql: `INSERT INTO writing_submissions
            (id, prompt_id, task_type, text, word_count, overall_band, bands, strengths, general_feedback, priorities, created_at, user_id)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    args: [
      `sub-${userId}-${promptId}-${Math.random()}`,
      promptId,
      "task2",
      "an essay",
      260,
      band,
      "{}",
      "[]",
      "",
      "[]",
      Date.now(),
      userId,
    ],
  });
}

beforeAll(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "lexi-wkind-"));
  process.env.DATABASE_URL = `file:${path.join(dir, "t.db")}`;
  delete process.env.DATABASE_AUTH_TOKEN;
  delete process.env.SHEET_ID;
  ({ writingPromptKind: adapter } = await import("@/lib/assignments/kinds/writing"));

  await seedPrompt("wp-pub-1", "__system__", "public", "task2", "Some people think...");
  await seedPrompt("wp-pub-t1", "__system__", "public", "task1", "The chart shows...");
  await seedPrompt("wp-priv", "teacher-x", "private", "task2", "Private draft");
});

describe("writing_prompt adapter", () => {
  it("registers with a stable key + label/emoji", () => {
    expect(adapter.kind).toBe("writing_prompt");
    expect(adapter.label).toBeTruthy();
    expect(adapter.emoji).toBeTruthy();
  });

  it("(a) listPickable lists PUBLIC prompts and filters by q", async () => {
    const all = await adapter.listPickable("teacher-x", "");
    const refs = all.map((c) => c.ref);
    expect(refs).toContain("wp-pub-1");
    expect(refs).toContain("wp-pub-t1");
    // A private prompt (even the teacher's own) is NOT assignable — the student
    // would not be able to open it (writing has no visibility grant).
    expect(refs).not.toContain("wp-priv");

    const filtered = await adapter.listPickable("teacher-x", "chart");
    expect(filtered.map((c) => c.ref)).toEqual(["wp-pub-t1"]);
  });

  it("(b) deep-links into the existing writing flow by task type", async () => {
    const t2 = await adapter.resolveCard("wp-pub-1");
    expect(t2.doHref).toBe("/writing/task2?q=wp-pub-1");
    expect(t2.available).toBe(true);
    const t1 = await adapter.resolveCard("wp-pub-t1");
    expect(t1.doHref).toBe("/writing/task1?q=wp-pub-t1");
    // The picker row carries the same deep-link.
    const pick = (await adapter.listPickable("teacher-x", "")).find((c) => c.ref === "wp-pub-t1");
    expect(pick?.doHref).toBe("/writing/task1?q=wp-pub-t1");
  });

  it("resolveCard marks a removed prompt unavailable", async () => {
    const card = await adapter.resolveCard("nope-gone");
    expect(card.available).toBe(false);
  });

  it("validateRef: public ok; private rejected; missing rejected", async () => {
    expect((await adapter.validateRef("wp-pub-1", "teacher-x")).ok).toBe(true);
    expect((await adapter.validateRef("wp-priv", "teacher-x")).ok).toBe(false);
    expect((await adapter.validateRef("missing", "teacher-x")).ok).toBe(false);
  });

  it("(c) completion = submitted (single + batched)", async () => {
    // Before any submission: not started. (assignedAt=0 ⇒ any submission counts.)
    expect((await adapter.progressFor("stu-1", "wp-pub-1", {}, 0)).state).toBe("not_started");

    await seedSubmission("stu-1", "wp-pub-1", 6.5);

    const single = await adapter.progressFor("stu-1", "wp-pub-1", {}, 0);
    expect(single.state).toBe("complete");
    expect(single.pct).toBe(100);
    expect(single.detail).toMatch(/band 6\.5/);

    // Batched grid form: submitter complete, non-submitter not started; every id present.
    const many = await adapter.progressForMany(["stu-1", "stu-2"], "wp-pub-1", {}, { "stu-1": 0, "stu-2": 0 });
    expect(many["stu-1"].state).toBe("complete");
    expect(many["stu-2"].state).toBe("not_started");
  });
});
