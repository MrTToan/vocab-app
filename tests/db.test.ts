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

/*
 * Generalized query-plan guard (QW2). The ~5s /library delete was ONE query
 * missing ONE index (idx_uqs_question) turning a per-word DELETE into a full
 * SCAN of a table that grows with every question every user has ever seen. That
 * class — a hot/cascade query silently going O(total-DB-size) — is invisible to
 * a correctness suite. This sweep runs EXPLAIN QUERY PLAN over the app's hot
 * per-user and cascade queries and asserts none of them plan as a BARE full
 * `SCAN` of a user-growth table (user_words / user_question_state / attempts /
 * llm_usage) or its alias. An index-organized `SCAN … USING [COVERING] INDEX`
 * (how an admin aggregate legitimately reads a whole table) and `SEARCH …` are
 * both fine — only a table row-scan of a growth table is the bug signature.
 *
 * These SQL strings MIRROR the store queries (lib/store.ts listPage() /
 * practiceCandidatesLite() / remove(); lib/admin/stats.ts). If a store query
 * changes shape, update its mirror here so the guard keeps tracking it.
 */
const WEAK_SQL = `(
  uw.recent_results IS NOT NULL
  AND json_array_length(uw.recent_results) > 0
  AND (
    (SELECT AVG(CASE value WHEN 'correct' THEN 1.0 WHEN 'partial' THEN 0.5 ELSE 0 END)
       FROM json_each(uw.recent_results)) < 0.6
    OR json_extract(uw.recent_results, '$[' || (json_array_length(uw.recent_results) - 1) || ']') = 'incorrect'
  )
)`;

/**
 * Each case: the SQL, and the growth-table names/aliases that must NOT appear
 * as a BARE `SCAN` (a full-table row scan). `args` supplies bind values so the
 * planner sees the same shape it does at runtime.
 */
const PLAN_CASES: Array<{
  name: string;
  sql: string;
  args?: unknown[];
  noScan: string[];
}> = [
  // ── full word-delete cascade (owner branch, lib/store.ts remove()) ──
  {
    name: "delete cascade: prune question recency",
    sql: "DELETE FROM user_question_state WHERE question_id IN (SELECT id FROM questions WHERE word_id = ?)",
    args: ["w"],
    noScan: ["user_question_state"],
  },
  {
    name: "delete cascade: drop this word's progress",
    sql: "DELETE FROM user_words WHERE word_id = ?",
    args: ["w"],
    noScan: ["user_words"],
  },
  // ── Library list (lib/store.ts listPage) — every filter variant ──
  {
    name: "listPage: no collection",
    sql: "SELECT w.id FROM user_words uw JOIN words w ON w.id = uw.word_id WHERE uw.user_id = ? ORDER BY w.created_at DESC LIMIT 20 OFFSET 0",
    args: ["u"],
    noScan: ["uw", "user_words"],
  },
  {
    name: "listPage: collection filter (widened source)",
    sql: "SELECT w.id, (uw.word_id IS NOT NULL) studying FROM word_collections wc JOIN words w ON w.id = wc.word_id LEFT JOIN user_words uw ON uw.word_id = w.id AND uw.user_id = ? WHERE wc.collection_id = ? ORDER BY w.created_at DESC LIMIT 20 OFFSET 0",
    args: ["u", "c"],
    noScan: ["uw", "user_words"],
  },
  {
    name: "listPage: weak filter (json_each on recent_results)",
    sql: `SELECT w.id FROM user_words uw JOIN words w ON w.id = uw.word_id WHERE uw.user_id = ? AND ${WEAK_SQL} ORDER BY w.created_at DESC LIMIT 20 OFFSET 0`,
    args: ["u"],
    noScan: ["uw", "user_words"],
  },
  {
    name: "listPage: stage filter",
    sql: "SELECT w.id FROM user_words uw JOIN words w ON w.id = uw.word_id WHERE uw.user_id = ? AND COALESCE(uw.stage,'new') = ? ORDER BY w.created_at DESC LIMIT 20 OFFSET 0",
    args: ["u", "new"],
    noScan: ["uw", "user_words"],
  },
  // ── practice candidate pickers (lib/store.ts practiceCandidatesLite) ──
  {
    name: "practiceCandidatesLite: no collection",
    sql: "SELECT w.id, uw.stage FROM user_words uw JOIN words w ON w.id = uw.word_id WHERE uw.user_id = ? ORDER BY w.created_at DESC",
    args: ["u"],
    noScan: ["uw", "user_words"],
  },
  {
    name: "practiceCandidatesLite: collection",
    sql: "SELECT w.id, uw.stage FROM word_collections wc JOIN words w ON w.id = wc.word_id LEFT JOIN user_words uw ON uw.word_id = w.id AND uw.user_id = ? WHERE wc.collection_id = ? ORDER BY w.created_at DESC",
    args: ["u", "c"],
    noScan: ["uw", "user_words"],
  },
  // ── admin dashboard (lib/admin/stats.ts) — the per-user JOINs. The pure
  //    COUNT(*)/SUM aggregates legitimately scan a whole table, so only the
  //    per-user JOIN (which MUST stay index-served) is guarded here. ──
  {
    name: "adminStats: per-user studied counts (top users)",
    sql: "SELECT u.id, COUNT(uw.word_id) studied FROM users u LEFT JOIN user_words uw ON uw.user_id = u.id GROUP BY u.id ORDER BY studied DESC",
    noScan: ["uw"],
  },
  {
    name: "progress: per-user attempt history window",
    sql: "SELECT ts, result FROM attempts WHERE user_id = ? ORDER BY ts DESC LIMIT 200",
    args: ["u"],
    noScan: ["attempts"],
  },
];

describe("hot & cascade queries never full-scan a user-growth table", () => {
  // A dedicated in-memory client so these EXPLAIN reads never touch the shared
  // singleton the write tests use.
  let probe: import("@libsql/client").Client;
  beforeAll(async () => {
    const { createClient } = await import("@libsql/client");
    probe = createClient({ url: ":memory:" });
    await dbMod.migrate(probe);
  });

  it.each(PLAN_CASES)("$name", async ({ sql, args, noScan }) => {
    const plan = await probe.execute({ sql: "EXPLAIN QUERY PLAN " + sql, args: (args ?? []) as never });
    const detail = plan.rows.map((r) => String(r.detail)).join(" | ");
    for (const t of noScan) {
      // A BARE `SCAN <table>` (not followed by `USING <index>`) is a full-table
      // row scan — the missing-index bug signature. `SCAN … USING INDEX` and
      // `SEARCH …` are index-served and allowed.
      const bareScan = new RegExp(`\\bSCAN ${t}\\b(?! USING)`);
      expect(detail, `${t} full-scanned in: ${detail}`).not.toMatch(bareScan);
    }
  });

  it("the delete cascade is served by the covering index, not a scan", async () => {
    // Keep the sharpest single-query assertion (PR #43): the cascade DELETE must
    // ride idx_uqs_question specifically, as a COVERING INDEX lookup.
    const plan = await probe.execute({
      sql:
        "EXPLAIN QUERY PLAN DELETE FROM user_question_state " +
        "WHERE question_id IN (SELECT id FROM questions WHERE word_id = ?)",
      args: ["some-word-id"],
    });
    const detail = plan.rows.map((r) => String(r.detail)).join(" | ");
    expect(detail).toMatch(/user_question_state USING (COVERING )?INDEX idx_uqs_question/);
    expect(detail).not.toMatch(/SCAN user_question_state/);
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
