#!/usr/bin/env node
/*
 * One-time multi-tenant migration.
 *
 * - Creates the `users` table and the owner row (your account).
 * - Adds `user_id` to every data table (idempotent — safe to re-run).
 * - Backfills user_id = OWNER_ID on all pre-existing rows (those with NULL/empty
 *   user_id), so your ~1,128 words + bank + writing data become YOUR account's.
 *
 * Target DB = $DATABASE_URL, else file:.data/lexi.db.
 * ALWAYS dry-run against a COPY first:
 *   DATABASE_URL=file:.data/backups/<copy>/lexi.db node scripts/migrate-multitenant.mjs
 *
 * OWNER_ID must match DEV_USER_ID in lib/auth/user.ts so local dev shows your data,
 * and OWNER_EMAIL lets your Google sign-in reclaim it in Phase 1.
 */
import { createClient } from "@libsql/client";
import path from "path";

const OWNER_ID = "local-user";
const OWNER_EMAIL = "vothientoan999@gmail.com";
const OWNER_NAME = "Toan";

const url =
  process.env.DATABASE_URL || `file:${path.resolve(".data/lexi.db")}`;
const authToken = process.env.DATABASE_AUTH_TOKEN;

const DATA_TABLES = [
  "words",
  "attempts",
  "questions",
  "collections",
  "word_collections",
  "writing_prompts",
  "writing_submissions",
  "writing_corrections",
];

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

async function main() {
  console.log(`\nMigrating: ${url}\n`);
  const db = createClient({ url, authToken });

  // 1) users table + owner
  await db.execute(
    `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT, name TEXT, image TEXT, created_at INTEGER)`,
  );
  await db.execute(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users (email)`);
  await db.execute({
    sql: `INSERT OR IGNORE INTO users (id, email, name, image, created_at) VALUES (?,?,?,?,?)`,
    args: [OWNER_ID, OWNER_EMAIL, OWNER_NAME, null, Date.now()],
  });
  console.log(`owner user ensured: ${OWNER_ID} <${OWNER_EMAIL}>`);

  // 2) add user_id to each existing data table + 3) backfill
  const report = [];
  for (const t of DATA_TABLES) {
    if (!(await tableExists(db, t))) {
      report.push({ table: t, status: "absent (skipped)" });
      continue;
    }
    await addColumn(db, t, "user_id TEXT");
    const before = await db.execute(
      `SELECT COUNT(*) n FROM ${t} WHERE user_id IS NULL OR user_id = ''`,
    );
    const orphans = Number(before.rows[0].n);
    if (orphans > 0) {
      await db.execute({
        sql: `UPDATE ${t} SET user_id = ? WHERE user_id IS NULL OR user_id = ''`,
        args: [OWNER_ID],
      });
    }
    const total = await db.execute(`SELECT COUNT(*) n FROM ${t}`);
    const mine = await db.execute({
      sql: `SELECT COUNT(*) n FROM ${t} WHERE user_id = ?`,
      args: [OWNER_ID],
    });
    report.push({
      table: t,
      backfilled: orphans,
      total: Number(total.rows[0].n),
      owner: Number(mine.rows[0].n),
    });
  }

  console.log("\nResult:");
  for (const r of report) {
    if (r.status) console.log(`  ${r.table.padEnd(22)} ${r.status}`);
    else
      console.log(
        `  ${r.table.padEnd(22)} total=${r.total}  backfilled=${r.backfilled}  owner=${r.owner}`,
      );
  }

  // 4) sanity: any rows still unowned?
  let stragglers = 0;
  for (const t of DATA_TABLES) {
    if (!(await tableExists(db, t))) continue;
    const rs = await db.execute(
      `SELECT COUNT(*) n FROM ${t} WHERE user_id IS NULL OR user_id = ''`,
    );
    stragglers += Number(rs.rows[0].n);
  }
  console.log(
    stragglers === 0
      ? "\n✅ all rows owned. migration complete.\n"
      : `\n⚠️  ${stragglers} rows still unowned — investigate.\n`,
  );
  process.exit(stragglers === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("migration failed:", e);
  process.exit(1);
});
