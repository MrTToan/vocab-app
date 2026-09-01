#!/usr/bin/env node
/*
 * Content/progress split migration (idempotent — safe to re-run).
 *
 * Separates shared CONTENT from per-user PROGRESS:
 *   1. Ensures new tables (user_words, user_question_state) and columns
 *      (words.owner_id, collections.owner_id, collections.visibility).
 *   2. Moves each words row's stage/times_seen/recent_results/last_seen_at into
 *      user_words (keyed by the row's existing user_id).
 *   3. Moves each questions row's last_shown into user_question_state.
 *   4. Sets words.owner_id = __system__ for the owner's rows (they become the
 *      canonical shared catalog), else the row's user_id (a user's personal word).
 *   5. Backfills collections.owner_id (= user_id) + visibility = 'private'
 *      (the owner's existing collections stay private for now).
 *   6. Dedups word CONTENT by normalized text into one canonical row, re-pointing
 *      user_words / questions / word_collections / attempts at the survivor.
 *
 * Legacy columns (user_id, the inline progress on words, questions.last_shown)
 * are left in place, unused — dropping them is destructive and unnecessary; the
 * new store selects only the columns it needs.
 *
 * Target DB = $DATABASE_URL, else file:.data/lexi.db.
 * ALWAYS develop/verify against a COPY first — NEVER the real DB:
 *   DATABASE_URL=file:/path/to/copy.db node scripts/migrate-content-split.mjs
 */
import { createClient } from "@libsql/client";
import path from "path";

const OWNER_ID = "local-user"; // must match DEV_USER_ID in lib/auth/user.ts
const SYSTEM_OWNER = "__system__"; // must match SYSTEM_OWNER in lib/auth/user.ts

const url = process.env.DATABASE_URL || `file:${path.resolve(".data/lexi.db")}`;
const authToken = process.env.DATABASE_AUTH_TOKEN;

async function addColumn(db, table, colDef) {
  try {
    await db.execute(`ALTER TABLE ${table} ADD COLUMN ${colDef}`);
  } catch {
    /* column already exists — fine */
  }
}
async function tableExists(db, name) {
  const rs = await db.execute({
    sql: "SELECT 1 FROM sqlite_master WHERE type='table' AND name=? LIMIT 1",
    args: [name],
  });
  return rs.rows.length > 0;
}
async function count(db, sql, args = []) {
  const rs = await db.execute({ sql, args });
  return Number(rs.rows[0]?.n ?? 0);
}
const norm = (s) => String(s ?? "").trim().toLowerCase();

async function main() {
  console.log(`\nContent/progress split — migrating: ${url}\n`);
  const db = createClient({ url, authToken });
  const report = [];

  // 1) new tables + columns ────────────────────────────────────────────
  await db.execute(
    `CREATE TABLE IF NOT EXISTS user_words (
       user_id TEXT, word_id TEXT, stage TEXT, times_seen INTEGER DEFAULT 0,
       recent_results TEXT DEFAULT '[]', last_seen_at INTEGER, added_at INTEGER,
       PRIMARY KEY (user_id, word_id)
     )`,
  );
  await db.execute(
    `CREATE TABLE IF NOT EXISTS user_question_state (
       user_id TEXT, question_id TEXT, last_shown INTEGER DEFAULT 0,
       PRIMARY KEY (user_id, question_id)
     )`,
  );
  if (await tableExists(db, "words")) await addColumn(db, "words", "owner_id TEXT");
  if (await tableExists(db, "collections")) {
    await addColumn(db, "collections", "owner_id TEXT");
    await addColumn(db, "collections", "visibility TEXT DEFAULT 'private'");
  }

  // 2) words.stage/progress → user_words (idempotent INSERT OR IGNORE) ───
  if (await tableExists(db, "words")) {
    const before = await count(db, "SELECT COUNT(*) n FROM user_words");
    await db.execute(
      `INSERT OR IGNORE INTO user_words
         (user_id, word_id, stage, times_seen, recent_results, last_seen_at, added_at)
       SELECT user_id, id,
              COALESCE(NULLIF(stage,''), 'new'),
              COALESCE(times_seen, 0),
              COALESCE(NULLIF(recent_results,''), '[]'),
              last_seen_at,
              COALESCE(created_at, 0)
         FROM words
        WHERE user_id IS NOT NULL AND user_id <> ''`,
    );
    const after = await count(db, "SELECT COUNT(*) n FROM user_words");
    report.push({ step: "user_words backfilled", added: after - before, total: after });
  }

  // 3) questions.last_shown → user_question_state ───────────────────────
  if (await tableExists(db, "questions")) {
    const before = await count(db, "SELECT COUNT(*) n FROM user_question_state");
    await db.execute(
      `INSERT OR IGNORE INTO user_question_state (user_id, question_id, last_shown)
       SELECT user_id, id, COALESCE(last_shown, 0)
         FROM questions
        WHERE user_id IS NOT NULL AND user_id <> ''`,
    );
    const after = await count(db, "SELECT COUNT(*) n FROM user_question_state");
    report.push({ step: "user_question_state backfilled", added: after - before, total: after });
  }

  // 4) words.owner_id (owner → __system__ catalog; others → their user_id) ─
  if (await tableExists(db, "words")) {
    const owned = await db.execute({
      sql: `UPDATE words SET owner_id = ?
             WHERE (owner_id IS NULL OR owner_id = '') AND user_id = ?`,
      args: [SYSTEM_OWNER, OWNER_ID],
    });
    const others = await db.execute({
      sql: `UPDATE words SET owner_id = user_id
             WHERE (owner_id IS NULL OR owner_id = '') AND user_id IS NOT NULL AND user_id <> ''`,
    });
    report.push({
      step: "words.owner_id set",
      system: owned.rowsAffected ?? 0,
      personal: others.rowsAffected ?? 0,
    });
  }

  // 5) collections.owner_id + visibility ────────────────────────────────
  if (await tableExists(db, "collections")) {
    const o = await db.execute(
      `UPDATE collections SET owner_id = user_id
        WHERE (owner_id IS NULL OR owner_id = '') AND user_id IS NOT NULL AND user_id <> ''`,
    );
    const v = await db.execute(
      `UPDATE collections SET visibility = 'private'
        WHERE visibility IS NULL OR visibility = ''`,
    );
    report.push({
      step: "collections backfilled",
      owner_set: o.rowsAffected ?? 0,
      visibility_set: v.rowsAffected ?? 0,
    });
  }

  // 6) dedup CONTENT by normalized word text → one canonical row ─────────
  let remaps = 0;
  if (await tableExists(db, "words")) {
    const rs = await db.execute(
      `SELECT id, word, owner_id, created_at FROM words`,
    );
    const groups = new Map(); // key -> rows[]
    for (const r of rs.rows) {
      const k = norm(r.word);
      if (!k) continue;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push({
        id: String(r.id),
        owner_id: String(r.owner_id ?? ""),
        created_at: Number(r.created_at ?? 0),
      });
    }
    const stmts = [];
    for (const rows of groups.values()) {
      if (rows.length < 2) continue;
      // Canonical: prefer a __system__ row, then earliest created_at, then id.
      rows.sort(
        (a, b) =>
          (b.owner_id === SYSTEM_OWNER) - (a.owner_id === SYSTEM_OWNER) ||
          a.created_at - b.created_at ||
          (a.id < b.id ? -1 : 1),
      );
      const canonical = rows[0].id;
      for (const dup of rows.slice(1)) {
        remaps++;
        // Re-point per-user progress + bank + groupings + attempts, then drop the
        // dup content. INSERT OR IGNORE avoids PK clashes when a user already has
        // a row for the canonical id (their more-advanced row wins; dup dropped).
        stmts.push(
          {
            sql: `INSERT OR IGNORE INTO user_words
                   (user_id, word_id, stage, times_seen, recent_results, last_seen_at, added_at)
                   SELECT user_id, ?, stage, times_seen, recent_results, last_seen_at, added_at
                     FROM user_words WHERE word_id = ?`,
            args: [canonical, dup.id],
          },
          { sql: `DELETE FROM user_words WHERE word_id = ?`, args: [dup.id] },
          { sql: `UPDATE questions SET word_id = ? WHERE word_id = ?`, args: [canonical, dup.id] },
          {
            sql: `INSERT OR IGNORE INTO word_collections (word_id, collection_id)
                   SELECT ?, collection_id FROM word_collections WHERE word_id = ?`,
            args: [canonical, dup.id],
          },
          { sql: `DELETE FROM word_collections WHERE word_id = ?`, args: [dup.id] },
          { sql: `UPDATE attempts SET word_id = ? WHERE word_id = ?`, args: [canonical, dup.id] },
          { sql: `DELETE FROM words WHERE id = ?`, args: [dup.id] },
        );
      }
    }
    if (stmts.length) await db.batch(stmts, "write");
    report.push({ step: "content dedup", canonicalized_dups: remaps });
  }

  // ── report ────────────────────────────────────────────────────────────
  console.log("Result:");
  for (const r of report) console.log("  " + JSON.stringify(r));

  // sanity: every word row is owned, and every user_words points at a real word
  const unowned = await count(
    db,
    "SELECT COUNT(*) n FROM words WHERE owner_id IS NULL OR owner_id = ''",
  );
  const orphanProgress = await count(
    db,
    "SELECT COUNT(*) n FROM user_words uw LEFT JOIN words w ON w.id = uw.word_id WHERE w.id IS NULL",
  );
  const words = await count(db, "SELECT COUNT(*) n FROM words");
  const uw = await count(db, "SELECT COUNT(*) n FROM user_words");
  console.log(
    `\n  words=${words}  user_words=${uw}  unowned=${unowned}  orphan_progress=${orphanProgress}`,
  );
  const ok = unowned === 0 && orphanProgress === 0;
  console.log(ok ? "\n✅ migration complete.\n" : "\n⚠️  investigate the counts above.\n");
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error("migration failed:", e);
  process.exit(1);
});
