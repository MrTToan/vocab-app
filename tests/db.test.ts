import { describe, it, expect, beforeAll } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";

/*
 * The single-connection DB module (lib/db.ts): one memoized client per process,
 * WAL + busy_timeout on file DBs, and all schema owned by migrate(). Also
 * covers the atomic recordResult (progress upsert + attempt insert in one
 * write batch). Uses a fresh temp DB — never the real .data/lexi.db.
 */

let dbMod: typeof import("../lib/db");

beforeAll(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "lexi-db-"));
  process.env.DATABASE_URL = `file:${path.join(dir, "t.db")}`;
  delete process.env.DATABASE_AUTH_TOKEN;
  delete process.env.SHEET_ID; // force the sqlite backend
  dbMod = await import("../lib/db");
});

describe("lib/db getDb()", () => {
  it("memoizes: returns the same client twice", async () => {
    const a = await dbMod.getDb();
    const b = await dbMod.getDb();
    expect(a).toBe(b);
  });

  it("enables WAL on a file DB", async () => {
    const db = await dbMod.getDb();
    const rs = await db.execute("PRAGMA journal_mode");
    expect(String(Object.values(rs.rows[0] as object)[0]).toLowerCase()).toBe("wal");
  });

  it("sets the busy timeout", async () => {
    const db = await dbMod.getDb();
    const rs = await db.execute("PRAGMA busy_timeout");
    expect(Number(Object.values(rs.rows[0] as object)[0])).toBe(5000);
  });

  it("migrate() created the full schema and recorded a version", async () => {
    const db = await dbMod.getDb();
    const rs = await db.execute(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    );
    const tables = rs.rows.map((r) => String(r.name));
    for (const t of [
      "words",
      "questions",
      "user_words",
      "user_question_state",
      "attempts",
      "users",
      "collections",
      "word_collections",
      "llm_usage",
      "writing_prompts",
      "writing_submissions",
      "writing_corrections",
      "writing_discussions",
      "schema_version",
    ]) {
      expect(tables).toContain(t);
    }
    const v = await db.execute("SELECT MAX(version) AS v FROM schema_version");
    expect(Number(v.rows[0].v)).toBe(dbMod.SCHEMA_VERSION);

    const idx = await db.execute("SELECT name FROM sqlite_master WHERE type = 'index'");
    const names = idx.rows.map((r) => String(r.name));
    for (const i of [
      "idx_attempts_user_ts",
      "idx_wc_user",
      "idx_uw_word",
      "idx_wp_owner_vis",
      "idx_uqs_question",
    ]) {
      expect(names).toContain(i);
    }
  });

  it("the word-delete cascade never full-scans user_question_state", async () => {
    // Regression: deleting a word prunes question recency via
    // `question_id IN (SELECT id FROM questions WHERE word_id = ?)`. The
    // (user_id, question_id) PK can't serve a question_id-only lookup, so without
    // idx_uqs_question this DELETE scans the whole table (slow at scale — the
    // ~5s /library delete). Assert migrate() gives the planner the index to use,
    // not a SCAN. Runs on its own throwaway client so the EXPLAIN read snapshot
    // never touches the shared singleton connection the other tests write on.
    const { createClient } = await import("@libsql/client");
    const probe = createClient({ url: ":memory:" });
    await dbMod.migrate(probe);
    const plan = await probe.execute({
      sql:
        "EXPLAIN QUERY PLAN DELETE FROM user_question_state " +
        "WHERE question_id IN (SELECT id FROM questions WHERE word_id = ?)",
      args: ["some-word-id"],
    });
    const detail = plan.rows.map((r) => String(r.detail)).join(" | ");
    expect(detail).toMatch(/user_question_state USING (COVERING )?INDEX idx_uqs_question/);
    expect(detail).not.toMatch(/SCAN user_question_state/);
    probe.close();
  });

  it("every store module shares the one client", async () => {
    const db = await dbMod.getDb();
    const { getStore } = await import("../lib/store");
    const store = getStore() as unknown as {
      db: unknown;
      forUser(id: string): { all(): Promise<unknown[]> };
    };
    await store.forUser("u1").all(); // forces the store to connect
    expect(store.db).toBe(db);
  });
});

describe("recordResult", () => {
  it("writes the progress row and the attempt row in one call", async () => {
    const { getStore } = await import("../lib/store");
    const s = getStore().forUser("u-record");
    const w = await s.add({ word: "atomic", vi_meaning: "nguyên tử" });
    const ts = Date.now();
    const updated = await s.recordResult(
      w.id,
      { stage: "recognition", times_seen: 1, recent_results: ["correct"], last_seen_at: ts },
      { word_id: w.id, exercise_type: "mcq_en_vi", result: "correct", ts },
    );
    expect(updated?.stage).toBe("recognition");
    expect(updated?.times_seen).toBe(1);

    const db = await dbMod.getDb();
    const uw = await db.execute({
      sql: "SELECT stage FROM user_words WHERE user_id = ? AND word_id = ?",
      args: ["u-record", w.id],
    });
    expect(String(uw.rows[0].stage)).toBe("recognition");
    const at = await db.execute({
      sql: "SELECT result, exercise_type FROM attempts WHERE user_id = ? AND word_id = ?",
      args: ["u-record", w.id],
    });
    expect(at.rows.length).toBe(1);
    expect(String(at.rows[0].result)).toBe("correct");
  });
});
