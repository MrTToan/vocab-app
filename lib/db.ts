import { promises as fs } from "fs";
import path from "path";
import type { Client } from "@libsql/client";
import { SYSTEM_OWNER } from "./auth/user";

/** Shared-content columns of the `words` table (progress lives in user_words). */
export const CONTENT_COLS = [
  "id",
  "word",
  "part_of_speech",
  "ipa",
  "vi_meaning",
  "definition_en",
  "synonyms",
  "collocations",
  "example_simple",
  "example_complex",
  "false_friend_note",
  "personal_note",
  "tags",
  "source",
  "created_at",
] as const;

/*
 * The ONE libSQL connection for the whole process.
 *
 * Every server-side module that touches the database (`lib/store.ts`,
 * `lib/writing/store.ts`, `lib/auth/store.ts`, `lib/auth/quota.ts`,
 * `lib/admin/stats.ts`) calls `getDb()`. Previously each opened its own client
 * on the same SQLite file and ran its own DDL on first use, so concurrent
 * learners fought over the file lock ("database is locked") and the first
 * request after a deploy paid all the schema work. Now:
 *
 *   - `getDb()` memoizes a single client promise per process.
 *   - On a `file:` URL it enables WAL + a 5 s busy timeout so readers never
 *     block writers and short lock contention waits instead of failing.
 *   - `migrate()` owns ALL schema statements (tables, guarded ADD COLUMNs,
 *     backfills, indexes) in one place and runs exactly once, before the first
 *     query. `instrumentation.ts` calls `getDb()` at server boot so the DB is
 *     warm and migrated before the first user request.
 *
 * URL resolution is unchanged: `DATABASE_URL` (libsql://… for Turso, or a
 * `file:` path) or `file:<cwd>/.data/lexi.db`, with `DATABASE_AUTH_TOKEN`.
 * The standalone `scripts/*.mjs` still open their own client; WAL is a property
 * of the database file, so they keep working against it.
 */

let dbPromise: Promise<Client> | null = null;

/** Resolve the connection URL exactly as the app always has (mkdir for file DBs). */
export async function resolveDatabaseUrl(): Promise<string> {
  let url = process.env.DATABASE_URL;
  if (!url) {
    const dir = path.join(process.cwd(), ".data");
    await fs.mkdir(dir, { recursive: true });
    url = `file:${path.join(dir, "lexi.db")}`;
  } else if (url.startsWith("file:")) {
    const p = url.slice("file:".length);
    await fs.mkdir(path.dirname(path.resolve(p)), { recursive: true });
  }
  return url;
}

/** The process-wide client. Memoized; the schema is migrated before it resolves. */
export function getDb(): Promise<Client> {
  if (!dbPromise) {
    dbPromise = open().catch((err) => {
      dbPromise = null; // let a later call retry instead of caching the failure
      throw err;
    });
  }
  return dbPromise;
}

async function open(): Promise<Client> {
  const { createClient } = await import("@libsql/client");
  const url = await resolveDatabaseUrl();
  const db = createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN });
  if (url.startsWith("file:")) await applyPragmas(db);
  await migrate(db);
  return db;
}

/**
 * Connection PRAGMAs for a local SQLite file. Each is applied on its own so a
 * server (e.g. remote libsql/Turso, which owns its journal mode) rejecting one
 * doesn't prevent the rest; a rejection is logged once and otherwise ignored.
 */
const PRAGMAS = [
  "PRAGMA journal_mode=WAL",
  "PRAGMA synchronous=NORMAL",
  "PRAGMA busy_timeout=5000",
  "PRAGMA foreign_keys=ON",
];

async function applyPragmas(db: Client): Promise<void> {
  for (const sql of PRAGMAS) {
    try {
      await db.execute(sql);
    } catch (err) {
      console.warn(`[db] ${sql} not applied: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

/** Add a column if it doesn't already exist (SQLite has no IF NOT EXISTS for ADD COLUMN). */
async function addColumn(db: Client, table: string, colDef: string): Promise<void> {
  try {
    await db.execute(`ALTER TABLE ${table} ADD COLUMN ${colDef}`);
  } catch {
    /* column already exists */
  }
}

/**
 * Current schema version. Bump it when adding a step that must NOT re-run on
 * every boot (a one-off data rewrite, say) and gate that step on
 * `fromVersion < N`. Everything below is idempotent, so it runs unconditionally
 * — that keeps a DB created by an older build, or by `scripts/*.mjs`, converging
 * to the full schema.
 */
export const SCHEMA_VERSION = 1;

/**
 * All DDL, in the order the per-module connects used to run it:
 * vocab store → users → llm_usage → writing. Every statement is idempotent.
 */
export async function migrate(db: Client): Promise<void> {
  await db.execute(`CREATE TABLE IF NOT EXISTS schema_version (version INTEGER)`);
  const vr = await db.execute(`SELECT MAX(version) AS v FROM schema_version`);
  const fromVersion = Number(vr.rows[0]?.v ?? 0);

  // ── vocab: shared CONTENT ──────────────────────────────────────────────
  const contentCols = CONTENT_COLS.map((h) => `"${h}" TEXT`).join(", ");
  await db.execute(
    `CREATE TABLE IF NOT EXISTS words (${contentCols}, owner_id TEXT, PRIMARY KEY ("id"))`,
  );
  await db.execute(
    `CREATE TABLE IF NOT EXISTS questions (id TEXT PRIMARY KEY, word_id TEXT, type TEXT, direction TEXT, payload TEXT, answer TEXT)`,
  );

  // ── vocab: per-user PROGRESS ───────────────────────────────────────────
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
  await db.execute(
    `CREATE TABLE IF NOT EXISTS attempts (ts INTEGER, word_id TEXT, exercise_type TEXT, result TEXT, user_id TEXT)`,
  );
  await db.execute(
    `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT, name TEXT, image TEXT, created_at INTEGER)`,
  );

  // ── collections (owner_id + visibility) ────────────────────────────────
  await db.execute(
    `CREATE TABLE IF NOT EXISTS collections (id TEXT PRIMARY KEY, name TEXT, description TEXT, emoji TEXT, created_at INTEGER, owner_id TEXT, visibility TEXT DEFAULT 'private')`,
  );
  await db.execute(
    `CREATE TABLE IF NOT EXISTS word_collections (word_id TEXT, collection_id TEXT, PRIMARY KEY (word_id, collection_id))`,
  );

  // Additive migrations for DBs created before the content/progress split.
  await addColumn(db, "words", "owner_id TEXT");
  await addColumn(db, "collections", "owner_id TEXT");
  await addColumn(db, "collections", "visibility TEXT DEFAULT 'private'");

  // Vocab lookup indexes (content is global; progress/state keyed per user).
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_word ON words (word COLLATE NOCASE)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_words_owner ON words (owner_id)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_q ON questions (word_id, type)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_uw_user ON user_words (user_id)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_uqs_user ON user_question_state (user_id)`);
  await db.execute(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users (email)`);
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_wc_collection ON word_collections (collection_id)`,
  );
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_wc_word ON word_collections (word_id)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_collections_owner ON collections (owner_id)`);

  // ── LLM quota ledger (lib/auth/quota.ts) ───────────────────────────────
  await db.execute(
    `CREATE TABLE IF NOT EXISTS llm_usage (
      user_id TEXT, day TEXT, task TEXT, count INTEGER DEFAULT 0,
      PRIMARY KEY (user_id, day, task)
    )`,
  );

  // ── writing (lib/writing/store.ts) ─────────────────────────────────────
  await db.execute(
    `CREATE TABLE IF NOT EXISTS writing_prompts (
      id TEXT PRIMARY KEY, task_type TEXT, title TEXT, prompt_text TEXT,
      image_path TEXT, chart_data TEXT, model_answer TEXT, source_file TEXT,
      tags TEXT, last_shown INTEGER DEFAULT 0, created_at INTEGER, user_id TEXT
    )`,
  );
  await db.execute(
    `CREATE TABLE IF NOT EXISTS writing_submissions (
      id TEXT PRIMARY KEY, prompt_id TEXT, task_type TEXT, text TEXT,
      word_count INTEGER, overall_band REAL, bands TEXT, strengths TEXT,
      general_feedback TEXT, priorities TEXT, created_at INTEGER, user_id TEXT
    )`,
  );
  await db.execute(
    `CREATE TABLE IF NOT EXISTS writing_corrections (
      id TEXT PRIMARY KEY, submission_id TEXT, original TEXT, suggestion TEXT,
      error_type TEXT, criterion TEXT, explanation TEXT, start INTEGER, "end" INTEGER,
      user_id TEXT
    )`,
  );
  // migrations for DBs created before these columns existed
  await addColumn(db, "writing_submissions", "priorities TEXT");
  await addColumn(db, "writing_prompts", "user_id TEXT");
  await addColumn(db, "writing_submissions", "user_id TEXT");
  await addColumn(db, "writing_corrections", "user_id TEXT");
  // ownership + visibility (mirrors collections). Backfill: rows from before
  // this existed are the owner-curated bank everyone already uses → public.
  await addColumn(db, "writing_prompts", "owner_id TEXT");
  await addColumn(db, "writing_prompts", "visibility TEXT DEFAULT 'private'");
  await db.execute(
    `UPDATE writing_prompts SET owner_id = '${SYSTEM_OWNER}', visibility = 'public'
     WHERE owner_id IS NULL OR owner_id = ''`,
  );
  await db.execute(
    `UPDATE writing_prompts SET visibility = 'private' WHERE visibility IS NULL OR visibility = ''`,
  );
  await db.execute(
    `CREATE TABLE IF NOT EXISTS writing_discussions (
      id TEXT PRIMARY KEY, submission_id TEXT, card_key TEXT,
      role TEXT, content TEXT, seq INTEGER, created_at INTEGER
    )`,
  );
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_wp_task ON writing_prompts (task_type)`);
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_ws_user ON writing_submissions (user_id, prompt_id)`,
  );
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_wc_sub ON writing_corrections (submission_id)`);
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_wd_sub ON writing_discussions (submission_id, card_key, seq)`,
  );

  // ── indexes for hot queries that had none ──────────────────────────────
  // attempts: per-user history ordered by time (progress page, admin windows).
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_attempts_user_ts ON attempts (user_id, ts)`);
  // writing_corrections: per-user error-pattern aggregation.
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_wc_user ON writing_corrections (user_id)`);
  // user_words: "who studies this word" (delete cascade, admin counts).
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_uw_word ON user_words (word_id)`);
  // writing_prompts: the `public OR owner_id = caller` visibility filter.
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_wp_owner_vis ON writing_prompts (owner_id, visibility)`,
  );

  if (fromVersion < SCHEMA_VERSION) {
    await db.execute({
      sql: `INSERT INTO schema_version (version) VALUES (?)`,
      args: [SCHEMA_VERSION],
    });
  }
}
