import { describe, it, expect, beforeAll } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";

/*
 * Integration test for multi-tenant scoping under the content/progress split.
 * Points the libSQL store at a fresh temp DB (so it never touches the real
 * .data/lexi.db) and asserts:
 *   - PROGRESS is per-user: one user's study list / stages / attempts are private
 *     (via `user_words`), and a personal word is invisible to other users.
 *   - CONTENT editing is owner-gated: studying a word grants no edit rights.
 * The shared-content behaviour (a public catalog word is visible to everyone;
 * the question bank is shared with per-user recency) is covered in
 * content-split.test.ts. Also covers writing-prompt ownership/visibility and
 * the per-user LLM quota.
 */

let store: any;
const A = "user-a";
const B = "user-b";

beforeAll(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "lexi-mt-"));
  process.env.DATABASE_URL = `file:${path.join(dir, "t.db")}`;
  delete process.env.DATABASE_AUTH_TOKEN;
  delete process.env.SHEET_ID; // force the sqlite backend
  const mod = await import("../lib/store");
  store = mod.getStore();
});

describe("multi-tenant store scoping", () => {
  it("isolates each user's word list", async () => {
    const a = store.forUser(A);
    const b = store.forUser(B);
    await a.add({ word: "alpha", vi_meaning: "a" });
    await b.add({ word: "beta", vi_meaning: "b" });
    expect((await a.all()).map((w: any) => w.word)).toEqual(["alpha"]);
    expect((await b.all()).map((w: any) => w.word)).toEqual(["beta"]);
  });

  it("scopes findByWord per user", async () => {
    const a = store.forUser(A);
    const b = store.forUser(B);
    expect(await a.findByWord("beta")).toBeUndefined();
    expect((await b.findByWord("beta"))?.word).toBe("beta");
  });

  it("cannot see, edit, or remove another user's personal word", async () => {
    const a = store.forUser(A);
    const b = store.forUser(B);
    const [alpha] = await a.all();
    // alpha is A's personal word (owner_id = A) → invisible to B.
    expect(await b.get(alpha.id)).toBeUndefined();
    // studying/seeing grants no edit rights: a cross-user edit is forbidden.
    await expect(b.update(alpha.id, { vi_meaning: "hacked" })).rejects.toThrow(
      /forbidden|cannot edit/i,
    );
    await b.remove(alpha.id); // must be a no-op on A's content
    expect((await a.get(alpha.id))?.vi_meaning).toBe("a"); // untouched
  });

  it("keeps attempts private per user", async () => {
    const a = store.forUser(A);
    const b = store.forUser(B);
    const [alpha] = await a.all();
    await a.logAttempt({ word_id: alpha.id, exercise_type: "cloze", result: "correct", ts: 1 });
    expect((await a.attempts()).length).toBe(1);
    expect((await b.attempts()).length).toBe(0);
  });
});

describe("writing: prompt ownership + visibility, private scores", () => {
  const OWNER = "local-user"; // DEV_USER_ID = the site owner (lib/auth/user.ts)
  const P2 = {
    task_type: "task2" as const, title: "T", prompt_text: "Write about X.",
    image_path: null, chart_data: null, model_answer: null, source_file: "test",
  };

  it("a non-owner's prompt is PRIVATE to its author; submissions/stats stay private", async () => {
    const { writingStore } = await import("../lib/writing/store");
    const a = writingStore.forUser(A);
    const b = writingStore.forUser(B);

    const [saved] = await a.addPrompts([{ ...P2, id: "p1" }]);
    expect(saved.owner_id).toBe(A);
    expect(saved.visibility).toBe("private");

    // A sees it; B cannot list, fetch, pick or count it
    expect((await a.listPrompts()).map((p) => p.id)).toContain("p1");
    expect((await a.getPrompt("p1"))?.id).toBe("p1");
    expect((await b.listPrompts()).map((p) => p.id)).not.toContain("p1");
    expect(await b.getPrompt("p1")).toBeUndefined(); // B cannot score against it
    expect(await b.getPromptImage("p1")).toBeUndefined();
    expect(await b.promptCount("task2")).toBe(0);
    expect(await b.pickPrompt("task2")).toBeUndefined();

    // A submits an essay — private to A
    await a.addSubmission({
      prompt_id: "p1", task_type: "task2", text: "an essay long enough", word_count: 10,
      overall_band: 6, bands: {} as never, strengths: [], general_feedback: "",
      priorities: [], corrections: [],
    });
    expect(await a.submissionCount()).toBe(1);
    expect(await b.submissionCount()).toBe(0); // B never sees A's work
    expect(Object.keys(await a.promptStats())).toContain("p1");
    expect(Object.keys(await b.promptStats())).toHaveLength(0);
    expect(await b.latestSubmission("p1")).toBeNull();
    expect((await a.latestSubmission("p1"))?.prompt_id).toBe("p1");
  });

  it("legacy rows without an owner become public; the site owner's new prompt is public", async () => {
    const { writingStore } = await import("../lib/writing/store");
    const { createClient } = await import("@libsql/client");
    const db = createClient({ url: process.env.DATABASE_URL! });
    // ensure the schema exists, then plant a pre-ownership row directly
    await writingStore.forUser(A).promptCount();
    await db.execute({
      sql: `INSERT INTO writing_prompts (id, task_type, title, prompt_text, tags, created_at, user_id)
            VALUES ('legacy', 'task2', 'Old', 'A prompt from before ownership.', '[]', 1, 'local-user')`,
      args: [],
    });
    // the connect()-time backfill runs once per process; apply the same rule
    // here as a fresh process would on its next boot
    await db.execute(
      "UPDATE writing_prompts SET owner_id='__system__', visibility='public' WHERE owner_id IS NULL OR owner_id=''",
    );
    const seen = await writingStore.forUser(B).getPrompt("legacy");
    expect(seen?.owner_id).toBe("__system__");
    expect(seen?.visibility).toBe("public");
    expect((await writingStore.forUser(A).listPrompts()).map((p) => p.id)).toContain("legacy");

    const [mine] = await writingStore.forUser(OWNER).addPrompts([{ ...P2, id: "sys1" }]);
    expect(mine.owner_id).toBe("__system__");
    expect(mine.visibility).toBe("public");
    expect((await writingStore.forUser(B).listPrompts()).map((p) => p.id)).toContain("sys1");
  });

  it("only the site owner can publish; only the author/site owner can delete", async () => {
    const { writingStore, PromptForbiddenError } = await import("../lib/writing/store");
    const a = writingStore.forUser(A);
    const b = writingStore.forUser(B);
    const owner = writingStore.forUser(OWNER);

    await expect(a.setPromptVisibility("p1", "public")).rejects.toBeInstanceOf(PromptForbiddenError);
    expect(await b.setPromptVisibility("p1", "public")).toBeUndefined(); // invisible → not found
    expect((await a.getPrompt("p1"))?.visibility).toBe("private");

    // the site owner can publish a learner's private prompt by id, then everyone sees it
    expect((await owner.setPromptVisibility("p1", "public"))?.visibility).toBe("public");
    expect((await b.getPrompt("p1"))?.id).toBe("p1");
    expect((await owner.setPromptVisibility("p1", "private"))?.visibility).toBe("private");
    expect(await b.getPrompt("p1")).toBeUndefined();

    // deleting: B can't touch A's prompt (it is not even visible), A can't delete the shared bank
    expect(await b.deletePrompt("p1")).toBe(false);
    await expect(a.deletePrompt("sys1")).rejects.toBeInstanceOf(PromptForbiddenError);
    expect(await a.getPrompt("sys1")).toBeDefined();
    // the site owner can unpublish + delete bank prompts
    expect((await owner.setPromptVisibility("sys1", "private"))?.visibility).toBe("private");
    expect(await b.getPrompt("sys1")).toBeUndefined();
    expect(await owner.deletePrompt("sys1")).toBe(true);
    // and the author deletes their own
    expect(await a.deletePrompt("p1")).toBe(true);
    expect(await a.getPrompt("p1")).toBeUndefined();
  });

  it("listPrompts never ships image bytes; the image accessor is visibility-checked", async () => {
    const { writingStore } = await import("../lib/writing/store");
    const a = writingStore.forUser(A);
    const b = writingStore.forUser(B);
    const png = "data:image/png;base64,iVBORw0KGgo=";
    await a.addPrompts([{ ...P2, id: "img1", task_type: "task1", image_path: png }]);
    const rows = await a.listPrompts("task1");
    const row = rows.find((p) => p.id === "img1")!;
    expect(row).not.toHaveProperty("image_path");
    expect(row.has_image).toBe(true);
    for (const r of rows) expect(r).not.toHaveProperty("image_path");
    expect(await a.getPromptImage("img1")).toBe(png);
    expect(await b.getPromptImage("img1")).toBeUndefined();
  });
});

describe("per-user LLM quota", () => {
  it("never throttles the owner", async () => {
    const { reserveQuota } = await import("../lib/auth/quota");
    for (let i = 0; i < 5; i++) await reserveQuota("local-user", "enrich"); // no throw
  });

  it("caps a normal user at the configured limit", async () => {
    process.env.QUOTA_ENRICH = "2";
    const { reserveQuota, QuotaError } = await import("../lib/auth/quota");
    await reserveQuota("user-x", "enrich");
    await reserveQuota("user-x", "enrich");
    await expect(reserveQuota("user-x", "enrich")).rejects.toBeInstanceOf(QuotaError);
  });
});
