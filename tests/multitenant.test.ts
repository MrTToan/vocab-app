import { describe, it, expect, beforeAll } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";

/*
 * Integration test for multi-tenant scoping. Points the libSQL store at a fresh
 * temp DB (so it never touches the real .data/lexi.db) and asserts one user can
 * never see or mutate another user's data — the core safety guarantee of the
 * multi-tenant refactor. Also covers the per-user LLM quota.
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

  it("cannot get / update / remove another user's word", async () => {
    const a = store.forUser(A);
    const b = store.forUser(B);
    const [alpha] = await a.all();
    expect(await b.get(alpha.id)).toBeUndefined();
    expect(await b.update(alpha.id, { vi_meaning: "hacked" })).toBeUndefined();
    await b.remove(alpha.id); // must be a no-op across users
    expect((await a.get(alpha.id))?.vi_meaning).toBe("a"); // untouched
  });

  it("scopes questions and attempts per user", async () => {
    const a = store.forUser(A);
    const b = store.forUser(B);
    const [alpha] = await a.all();
    await a.addQuestions([
      { id: "q1", word_id: alpha.id, type: "cloze", direction: "", payload: "___ test", answer: "alpha" },
    ]);
    expect(await a.questionCount()).toBe(1);
    expect(await b.questionCount()).toBe(0);
    expect(await b.pickQuestion(alpha.id, "cloze")).toBeUndefined();

    await a.logAttempt({ word_id: alpha.id, exercise_type: "cloze", result: "correct", ts: 1 });
    expect((await a.attempts()).length).toBe(1);
    expect((await b.attempts()).length).toBe(0);
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
