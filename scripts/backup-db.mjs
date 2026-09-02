#!/usr/bin/env node
/*
 * Consistent SQLite backup via `VACUUM INTO` (safe with WAL: it takes a
 * transactional snapshot of the live DB — unlike a plain `cp`, which can copy
 * a torn, mid-write file).
 *
 * Writes <dir>/lexi.<YYYY-MM-DD-HHMM>.db, prunes snapshots older than
 * --keep-days (default 14), and prints the snapshot path.
 *
 * Runs inside the app container (where the DB lives), e.g. from server cron:
 *   docker compose -f docker-compose.prod.yml exec -T app \
 *     node scripts/backup-db.mjs --dir /app/.data/backups
 *
 * Locally: node scripts/backup-db.mjs [--dir .data/backups] [--keep-days 14]
 * Target DB = $DATABASE_URL (file: URLs only), else file:.data/lexi.db.
 */
import { createClient } from "@libsql/client";
import fs from "node:fs";
import path from "node:path";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const dir = path.resolve(arg("dir", path.join(".data", "backups")));
const keepDays = Number(arg("keep-days", "14"));
if (!Number.isFinite(keepDays) || keepDays <= 0) {
  console.error(`Invalid --keep-days: ${arg("keep-days", "14")}`);
  process.exit(1);
}

const url = process.env.DATABASE_URL || `file:${path.resolve(".data/lexi.db")}`;
if (!url.startsWith("file:")) {
  console.error(
    `backup-db only supports local file: databases (got ${url.split(":")[0]}:...). ` +
      "Remote/Turso DBs have their own backup story."
  );
  process.exit(1);
}

const now = new Date();
const pad = (n) => String(n).padStart(2, "0");
const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
const dest = path.join(dir, `lexi.${stamp}.db`);

fs.mkdirSync(dir, { recursive: true });
if (fs.existsSync(dest)) fs.rmSync(dest); // VACUUM INTO refuses to overwrite

const db = createClient({ url });
try {
  // Single quotes in SQL string literals are escaped by doubling.
  await db.execute(`VACUUM INTO '${dest.replaceAll("'", "''")}'`);
} finally {
  db.close();
}

// Sanity-check the snapshot is a readable database before pruning anything;
// a failed check removes the bad snapshot so cron never accumulates junk.
const check = createClient({ url: `file:${dest}` });
try {
  const r = await check.execute("SELECT count(*) AS n FROM words");
  console.error(`snapshot ok: ${r.rows[0].n} words`);
} catch (e) {
  check.close();
  fs.rmSync(dest, { force: true });
  console.error(`snapshot failed verification, removed: ${dest}`);
  throw e;
} finally {
  check.close();
}

// Prune snapshots older than keepDays (only files matching our naming scheme).
const cutoff = Date.now() - keepDays * 24 * 60 * 60 * 1000;
for (const f of fs.readdirSync(dir)) {
  if (!/^lexi\.\d{4}-\d{2}-\d{2}-\d{4}\.db$/.test(f)) continue;
  const p = path.join(dir, f);
  if (p === dest) continue;
  if (fs.statSync(p).mtimeMs < cutoff) {
    fs.rmSync(p);
    console.error(`pruned: ${f}`);
  }
}

console.log(dest);
