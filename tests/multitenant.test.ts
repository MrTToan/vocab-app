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
 * content-split.test.ts. Also covers the per-user LLM quota.
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

describe("writing: shared prompts, private scores", () => {
  it("prompts are shared across users but submissions/stats stay private", async () => {
    const { writingStore } = await import("../lib/writing/store");
    const a = writingStore.forUser(A);
    const b = writingStore.forUser(B);

    // A ingests a prompt — it belongs to the shared pool
    await a.addPrompts([
      {
        id: "p1", task_type: "task2", title: "T", prompt_text: "Write about X.",
        image_path: null, chart_data: null, model_answer: null, source_file: "test",
      },
    ]);

    // both users see the same shared prompt
    expect((await a.listPrompts()).map((p: any) => p.id)).toContain("p1");
    expect((await b.listPrompts()).map((p: any) => p.id)).toContain("p1");
    expect((await b.getPrompt("p1"))?.id).toBe("p1"); // B can score it too

    // A submits an essay — private to A
    await a.addSubmission({
      prompt_id: "p1", task_type: "task2", text: "an essay long enough", word_count: 10,
      overall_band: 6, bands: {} as any, strengths: [], general_feedback: "",
      priorities: [], corrections: [],
    });

    expect(await a.submissionCount()).toBe(1);
    expect(await b.submissionCount()).toBe(0); // B never sees A's work
    expect(Object.keys(await a.promptStats())).toContain("p1");
    expect(Object.keys(await b.promptStats())).toHaveLength(0);
    expect(await b.latestSubmission("p1")).toBeNull();
    expect((await a.latestSubmission("p1"))?.prompt_id).toBe("p1");
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
