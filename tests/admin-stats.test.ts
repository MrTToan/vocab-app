import { describe, it, expect, beforeAll } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";

/*
 * Integration test for the owner-only admin aggregate queries. Seeds a fresh
 * temp DB (never the real .data/lexi.db) with a couple of users and their
 * progress/attempts/LLM usage, then asserts adminStats() aggregates correctly
 * in SQL. Also confirms isOwner gates the portal to the single owner id.
 */

let adminStats: typeof import("../lib/admin/stats").adminStats;
let db: any;
const NOW = Date.UTC(2026, 8, 1, 12, 0); // 2026-09-01T12:00Z
const DAY = 86_400_000;

beforeAll(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "lexi-admin-"));
  process.env.DATABASE_URL = `file:${path.join(dir, "t.db")}`;
  delete process.env.DATABASE_AUTH_TOKEN;
  delete process.env.SHEET_ID;

  const { createClient } = await import("@libsql/client");
  db = createClient({ url: process.env.DATABASE_URL });

  await db.batch(
    [
      `CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT, name TEXT, image TEXT, created_at INTEGER)`,
      `CREATE TABLE words ("id" TEXT PRIMARY KEY, word TEXT, owner_id TEXT, created_at TEXT)`,
      `CREATE TABLE user_words (user_id TEXT, word_id TEXT, stage TEXT, times_seen INTEGER, recent_results TEXT, last_seen_at INTEGER, added_at INTEGER, PRIMARY KEY (user_id, word_id))`,
      `CREATE TABLE attempts (ts INTEGER, word_id TEXT, exercise_type TEXT, result TEXT, user_id TEXT)`,
      `CREATE TABLE llm_usage (user_id TEXT, day TEXT, task TEXT, count INTEGER, PRIMARY KEY (user_id, day, task))`,
    ],
    "write",
  );

  // Two users: 'alice' signed up today, 'bob' yesterday.
  await db.batch(
    [
      { sql: "INSERT INTO users (id,email,name,created_at) VALUES (?,?,?,?)", args: ["alice", "a@x.com", "Alice", NOW] },
      { sql: "INSERT INTO users (id,email,name,created_at) VALUES (?,?,?,?)", args: ["bob", "b@x.com", "Bob", NOW - DAY] },
      // shared catalog words
      { sql: `INSERT INTO words ("id",word,owner_id,created_at) VALUES (?,?,?,?)`, args: ["w1", "alpha", "__system__", "0"] },
      { sql: `INSERT INTO words ("id",word,owner_id,created_at) VALUES (?,?,?,?)`, args: ["w2", "beta", "__system__", "0"] },
      { sql: `INSERT INTO words ("id",word,owner_id,created_at) VALUES (?,?,?,?)`, args: ["w3", "gamma", "__system__", "0"] },
      // alice studies 3 words (one known), bob studies 1 (known)
      { sql: "INSERT INTO user_words (user_id,word_id,stage) VALUES (?,?,?)", args: ["alice", "w1", "known"] },
      { sql: "INSERT INTO user_words (user_id,word_id,stage) VALUES (?,?,?)", args: ["alice", "w2", "recall"] },
      { sql: "INSERT INTO user_words (user_id,word_id,stage) VALUES (?,?,?)", args: ["alice", "w3", "new"] },
      { sql: "INSERT INTO user_words (user_id,word_id,stage) VALUES (?,?,?)", args: ["bob", "w1", "known"] },
      // attempts: alice 2 today, bob 1 today
      { sql: "INSERT INTO attempts (ts,word_id,result,user_id) VALUES (?,?,?,?)", args: [NOW, "w1", "correct", "alice"] },
      { sql: "INSERT INTO attempts (ts,word_id,result,user_id) VALUES (?,?,?,?)", args: [NOW, "w2", "incorrect", "alice"] },
      { sql: "INSERT INTO attempts (ts,word_id,result,user_id) VALUES (?,?,?,?)", args: [NOW, "w1", "correct", "bob"] },
      // llm usage today
      { sql: "INSERT INTO llm_usage (user_id,day,task,count) VALUES (?,?,?,?)", args: ["alice", "2026-09-01", "enrich", 5] },
      { sql: "INSERT INTO llm_usage (user_id,day,task,count) VALUES (?,?,?,?)", args: ["alice", "2026-09-01", "score", 3] },
      { sql: "INSERT INTO llm_usage (user_id,day,task,count) VALUES (?,?,?,?)", args: ["bob", "2026-08-31", "enrich", 2] },
    ],
    "write",
  );

  ({ adminStats } = await import("../lib/admin/stats"));
});

describe("adminStats aggregates", () => {
  it("counts users and buckets signups by UTC day", async () => {
    const s = await adminStats(NOW);
    expect(s.users.total).toBe(2);
    expect(s.users.newInWindow).toBe(2);
    expect(s.users.signups.at(-1)).toMatchObject({ day: "2026-09-01", count: 1 });
    expect(s.users.cumulative.at(-1)!.count).toBe(2);
  });

  it("aggregates vocab studied counts and top users", async () => {
    const s = await adminStats(NOW);
    expect(s.vocab.catalogWords).toBe(3);
    expect(s.vocab.studiedInstances).toBe(4); // 3 alice + 1 bob
    expect(s.vocab.distinctStudied).toBe(3); // w1,w2,w3
    expect(s.vocab.topUsers[0]).toMatchObject({ label: "Alice", studied: 3, mastered: 1 });
  });

  it("counts mastered (stage=known) across all users", async () => {
    const s = await adminStats(NOW);
    expect(s.progress.mastered).toBe(2); // alice w1 + bob w1
  });

  it("ranks all users by words studied (descending), unpaginated", async () => {
    const s = await adminStats(NOW);
    expect(s.vocab.topUsers.map((u) => u.label)).toEqual(["Alice", "Bob"]);
    expect(s.vocab.topUsers.map((u) => u.studied)).toEqual([3, 1]);
  });

  it("aggregates activity: attempts and daily active users", async () => {
    const s = await adminStats(NOW);
    expect(s.activity.totalAttempts).toBe(3);
    expect(s.activity.attempts.at(-1)).toMatchObject({ day: "2026-09-01", count: 3 });
    expect(s.activity.activeUsers.at(-1)!.count).toBe(2); // alice + bob today
  });

  it("aggregates LLM usage by task, today, and top consumers", async () => {
    const s = await adminStats(NOW);
    expect(s.llm.total).toBe(10); // 5+3+2
    expect(s.llm.today).toBe(8); // alice's 5+3 on 2026-09-01
    expect(s.llm.byTask.enrich).toBe(7);
    expect(s.llm.byTask.score).toBe(3);
    expect(s.llm.topUsers[0]).toMatchObject({ label: "Alice", total: 8 });
  });
});

describe("owner gating", () => {
  it("isOwner recognises only the single owner id", async () => {
    const { isOwner, DEV_USER_ID } = await import("../lib/auth/user");
    expect(isOwner(DEV_USER_ID)).toBe(true);
    expect(isOwner("alice")).toBe(false);
    expect(isOwner("")).toBe(false);
  });
});
