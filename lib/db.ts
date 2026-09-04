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
export const SCHEMA_VERSION = 2;

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

  // Backfill legacy `words.owner_id`: rows created before the column existed
  // (the single-tenant era) have owner_id NULL, but every read gates on it —
  // `store.get()` fetches only `owner_id = __system__ OR owner_id = <you>`,
  // so a NULL-owner word is invisible to EVERYONE. That silently breaks the
  // practice loop: `/api/practice/next` serves such a word (it scopes by
  // user_words membership, not owner_id), but `/api/practice/score` and
  // `/result` then 404 on it — so "Check my answer" (LLM-scored) shows no
  // result, while locally-graded cards still show client-side feedback.
  // These pre-split rows are the owner-curated seed catalogue everyone already
  // studies (the public packs point at them), so they become `__system__` —
  // exactly the treatment the writing-prompt bank gets just below.
  await db.execute(
    `UPDATE words SET owner_id = '${SYSTEM_OWNER}' WHERE owner_id IS NULL OR owner_id = ''`,
  );

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

  // ── user feedback (lib/feedback/store.ts) ──────────────────────────────
  // Submissions from the in-app floating "Feedback" widget. Owner reads them in
  // the admin "Feedback" subtab. `rating` is nullable (the star rating is
  // optional); `page`/`user_agent` capture where it was sent from for triage.
  await db.execute(
    `CREATE TABLE IF NOT EXISTS feedback (
      id TEXT PRIMARY KEY, user_id TEXT, category TEXT, rating INTEGER,
      message TEXT, page TEXT, user_agent TEXT, created_at INTEGER
    )`,
  );
  // Admin list orders newest-first; a per-user index also covers "my feedback".
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_feedback_created ON feedback (created_at)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_feedback_user ON feedback (user_id, created_at)`);

  // ── classes (lib/classes/store.ts) ─────────────────────────────────────
  // The class entity + the user↔class membership junction. Role is stored PER
  // MEMBERSHIP (class_members.role), never folded into `classes` — that is the
  // seam a later assignments phase leans on (design report §2.3). Additive and
  // idempotent like everything above; no SCHEMA_VERSION bump, no backfill (no
  // existing row references a class).
  await db.execute(
    `CREATE TABLE IF NOT EXISTS classes (
      id           TEXT PRIMARY KEY,
      name         TEXT NOT NULL,
      description  TEXT DEFAULT '',
      emoji        TEXT DEFAULT '',
      created_by   TEXT NOT NULL,
      join_code    TEXT,
      created_at   INTEGER,
      archived_at  INTEGER
    )`,
  );
  // Every real join code is globally unique; SQLite treats NULLs as distinct, so
  // many classes may have NULL (join-by-code disabled) at once.
  await db.execute(`CREATE UNIQUE INDEX IF NOT EXISTS idx_classes_join_code ON classes (join_code)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_classes_created_by ON classes (created_by)`);
  await db.execute(
    `CREATE TABLE IF NOT EXISTS class_members (
      class_id   TEXT NOT NULL,
      user_id    TEXT NOT NULL,
      role       TEXT NOT NULL,
      joined_via TEXT,
      joined_at  INTEGER,
      PRIMARY KEY (class_id, user_id)
    )`,
  );
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_cm_user ON class_members (user_id)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_cm_class_role ON class_members (class_id, role)`);

  // ── class_invites: email invites, pending until accepted (Slice 3) ──────
  // An invite is keyed by EMAIL; a seat is taken only on accept (§8). Invite-by-
  // link first: each row carries an opaque `token` the teacher copies into an
  // accept link and sends through their own channel — real outbound email is a
  // later enhancement that drops in behind the same routes. Idempotent:
  // UNIQUE(class_id, email) makes re-inviting the same address update, never
  // duplicate. Additive/idempotent; no SCHEMA_VERSION bump, no backfill.
  await db.execute(
    `CREATE TABLE IF NOT EXISTS class_invites (
      id           TEXT PRIMARY KEY,
      class_id     TEXT NOT NULL,
      email        TEXT NOT NULL,
      invited_by   TEXT NOT NULL,
      token        TEXT,
      status       TEXT NOT NULL DEFAULT 'pending',
      created_at   INTEGER,
      responded_at INTEGER
    )`,
  );
  await db.execute(`CREATE UNIQUE INDEX IF NOT EXISTS idx_ci_class_email ON class_invites (class_id, email)`);
  await db.execute(`CREATE UNIQUE INDEX IF NOT EXISTS idx_ci_token ON class_invites (token)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_ci_email ON class_invites (email, status)`);

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
  // One-time adoption (v2): writing questions are now an ADMIN-managed bank —
  // only the owner/admin may create/edit/delete them. Prompts that regular
  // users created before this (owner_id = a real user id, i.e. not the shared
  // bank) are ADOPTED into the admin bank so admins can curate them: their
  // owner_id becomes `__system__` and their visibility is forced to `private`
  // (a DRAFT — never auto-published), so an admin publishes each deliberately
  // after review. No row is deleted and `user_id` (who originally created it) is
  // preserved, so the original author is still traceable. Gated on the schema
  // version so it runs exactly once (regular users can no longer create prompts,
  // so no legitimate user-owned prompt appears after this point).
  if (fromVersion < 2) {
    await db.execute(
      `UPDATE writing_prompts SET owner_id = '${SYSTEM_OWNER}', visibility = 'private'
       WHERE owner_id IS NOT NULL AND owner_id != '' AND owner_id != '${SYSTEM_OWNER}'`,
    );
  }
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
  // user_question_state: the delete cascade prunes a word's question recency via
  // `WHERE question_id IN (SELECT id FROM questions WHERE word_id = ?)`. Without
  // this index that DELETE is a full SCAN of user_question_state (the PK is
  // (user_id, question_id), useless for a question_id-only lookup), so a single
  // word deletion scans the whole table — which grows with every question every
  // user has ever seen. This turns it into an indexed lookup (EXPLAIN: COVERING
  // INDEX; ~460x on a 600k-row table). Regression guard: tests/db.test.ts.
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_uqs_question ON user_question_state (question_id)`);
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
