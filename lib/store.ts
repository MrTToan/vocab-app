import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import type { Word, Attempt, Question } from "./types";
// NOTE: writing prompts are a SHARED pool (see lib/writing/store.ts); only the
// vocab data below is per-user. Writing submissions/scores are per-user there.

/*
 * Storage lives behind this one interface. Two backends:
 *   - SqliteStore : libSQL/SQLite. Local = a fast file (.data/lexi.db, zero setup);
 *                   the SAME client talks to Turso (hosted libSQL) when deployed.
 *                   This is the default and the multi-tenant (deploy) backend.
 *   - SheetStore  : Google Sheet via a service account — a single-user local
 *                   workflow ("open my words in a spreadsheet"). NOT multi-tenant:
 *                   it ignores the user scope (one sheet = one user).
 * getStore() picks the backend from env and caches a single instance.
 *
 * MULTI-TENANCY: every row carries a user_id. Call sites never touch the raw
 * store — they go through getStore().forUser(userId), which returns a ScopedStore
 * whose every method is bound to that user. This keeps user scoping impossible to
 * forget at a call site.
 */

/** A user-scoped view of the store — every method operates on one user's data. */
export interface ScopedStore {
  all(): Promise<Word[]>;
  get(id: string): Promise<Word | undefined>;
  findByWord(word: string): Promise<Word | undefined>;
  add(word: NewWord): Promise<Word>;
  addMany(words: NewWord[]): Promise<Word[]>;
  update(id: string, patch: Partial<Word>): Promise<Word | undefined>;
  remove(id: string): Promise<void>;
  logAttempt(a: Attempt): Promise<void>;
  attempts(): Promise<Attempt[]>;
  addQuestions(qs: Question[]): Promise<void>;
  /** Least-recently-shown question of a type for a word (cycles the bank), marking it shown. */
  pickQuestion(wordId: string, type: string): Promise<Question | undefined>;
  questionCount(): Promise<number>;
  /** Distinct word_ids that already have at least one bank question. */
  questionWordIds(): Promise<string[]>;
  backend(): "sheet" | "sqlite";
}

export interface Store {
  /** Return a view of the store scoped to a single user. */
  forUser(userId: string): ScopedStore;
  backend(): "sheet" | "sqlite";
}

export type NewWord = Partial<Word> &
  Pick<Word, "word"> & { source?: Word["source"] };

export function normalizeWord(w: string): string {
  return w.trim().toLowerCase();
}

function makeWord(input: NewWord): Word {
  const now = Date.now();
  return {
    id: input.id ?? randomUUID(),
    word: input.word.trim(),
    part_of_speech: input.part_of_speech ?? "",
    ipa: input.ipa ?? "",
    vi_meaning: input.vi_meaning ?? "",
    definition_en: input.definition_en ?? "",
    synonyms: input.synonyms ?? [],
    collocations: input.collocations ?? [],
    example_simple: input.example_simple ?? "",
    example_complex: input.example_complex ?? "",
    false_friend_note: input.false_friend_note ?? "",
    personal_note: input.personal_note ?? "",
    tags: input.tags ?? [],
    source: input.source ?? "manual",
    stage: input.stage ?? "new",
    times_seen: input.times_seen ?? 0,
    recent_results: input.recent_results ?? [],
    last_seen_at: input.last_seen_at ?? null,
    created_at: input.created_at ?? now,
  };
}

/* ─────────────────────  Row (de)serialization  ─────────────────────── */

export const HEADERS = [
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
  "stage",
  "times_seen",
  "recent_results",
  "last_seen_at",
  "created_at",
] as const;

function toRow(w: Word): Record<string, string> {
  return {
    id: w.id,
    word: w.word,
    part_of_speech: w.part_of_speech,
    ipa: w.ipa,
    vi_meaning: w.vi_meaning,
    definition_en: w.definition_en,
    synonyms: JSON.stringify(w.synonyms),
    collocations: JSON.stringify(w.collocations),
    example_simple: w.example_simple,
    example_complex: w.example_complex,
    false_friend_note: w.false_friend_note,
    personal_note: w.personal_note,
    tags: JSON.stringify(w.tags),
    source: w.source,
    stage: w.stage,
    times_seen: String(w.times_seen),
    recent_results: JSON.stringify(w.recent_results),
    last_seen_at: w.last_seen_at === null ? "" : String(w.last_seen_at),
    created_at: String(w.created_at),
  };
}

function jsonArr(s: string | undefined): string[] {
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function fromRow(get: (k: string) => string | undefined): Word {
  return makeWord({
    id: get("id") || randomUUID(),
    word: get("word") || "",
    part_of_speech: get("part_of_speech") || "",
    ipa: get("ipa") || "",
    vi_meaning: get("vi_meaning") || "",
    definition_en: get("definition_en") || "",
    synonyms: jsonArr(get("synonyms")),
    collocations: jsonArr(get("collocations")),
    example_simple: get("example_simple") || "",
    example_complex: get("example_complex") || "",
    false_friend_note: get("false_friend_note") || "",
    personal_note: get("personal_note") || "",
    tags: jsonArr(get("tags")),
    source: (get("source") as Word["source"]) || "manual",
    stage: (get("stage") as Word["stage"]) || "new",
    times_seen: Number(get("times_seen") || 0),
    recent_results: jsonArr(get("recent_results")) as Word["recent_results"],
    last_seen_at: get("last_seen_at") ? Number(get("last_seen_at")) : null,
    created_at: Number(get("created_at") || Date.now()),
  });
}

/* ───────────────────────────  SQLite / libSQL  ─────────────────────── */

// Loaded lazily so nothing depends on the sheet libs unless the Sheet is used.
class SqliteStore implements Store {
  private db: any = null;
  private ready: Promise<void> | null = null;

  backend(): "sqlite" {
    return "sqlite";
  }

  forUser(userId: string): ScopedStore {
    return makeScoped(this, userId);
  }

  private async connect(): Promise<void> {
    if (this.ready) return this.ready;
    this.ready = (async () => {
      const { createClient } = await import("@libsql/client");
      let url = process.env.DATABASE_URL;
      if (!url) {
        const dir = path.join(process.cwd(), ".data");
        await fs.mkdir(dir, { recursive: true });
        url = `file:${path.join(dir, "lexi.db")}`;
      } else if (url.startsWith("file:")) {
        // ensure the directory exists for a file: url
        const p = url.slice("file:".length);
        await fs.mkdir(path.dirname(path.resolve(p)), { recursive: true });
      }
      this.db = createClient({
        url,
        authToken: process.env.DATABASE_AUTH_TOKEN, // for Turso; undefined for file
      });
      const cols = HEADERS.map((h) => `"${h}" TEXT`).join(", ");
      // user_id carried on every table for multi-tenancy.
      await this.db.execute(
        `CREATE TABLE IF NOT EXISTS words (${cols}, user_id TEXT, PRIMARY KEY ("id"))`,
      );
      await this.db.execute(
        `CREATE TABLE IF NOT EXISTS attempts (ts INTEGER, word_id TEXT, exercise_type TEXT, result TEXT, user_id TEXT)`,
      );
      await this.db.execute(
        `CREATE TABLE IF NOT EXISTS questions (id TEXT PRIMARY KEY, word_id TEXT, type TEXT, direction TEXT, payload TEXT, answer TEXT, last_shown INTEGER DEFAULT 0, user_id TEXT)`,
      );
      await this.db.execute(
        `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT, name TEXT, image TEXT, created_at INTEGER)`,
      );
      // Additive migrations for DBs created before multi-tenancy. Each ALTER is
      // guarded so a re-run (column already exists) is a no-op.
      await addColumn(this.db, "words", "user_id TEXT");
      await addColumn(this.db, "attempts", "user_id TEXT");
      await addColumn(this.db, "questions", "user_id TEXT");
      // Per-user lookup indexes.
      await this.db.execute(
        `CREATE INDEX IF NOT EXISTS idx_word ON words (user_id, word COLLATE NOCASE)`,
      );
      await this.db.execute(
        `CREATE INDEX IF NOT EXISTS idx_q ON questions (user_id, word_id, type)`,
      );
      await this.db.execute(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users (email)`,
      );
    })();
    return this.ready;
  }

  private mapRow(row: any): Word {
    return fromRow((k) => (row[k] == null ? undefined : String(row[k])));
  }

  async all(userId: string): Promise<Word[]> {
    await this.connect();
    const rs = await this.db.execute({
      sql: "SELECT * FROM words WHERE user_id = ? ORDER BY created_at DESC",
      args: [userId],
    });
    return rs.rows.map((r: any) => this.mapRow(r));
  }
  async get(userId: string, id: string): Promise<Word | undefined> {
    await this.connect();
    const rs = await this.db.execute({
      sql: "SELECT * FROM words WHERE user_id = ? AND id = ? LIMIT 1",
      args: [userId, id],
    });
    return rs.rows[0] ? this.mapRow(rs.rows[0]) : undefined;
  }
  async findByWord(userId: string, word: string): Promise<Word | undefined> {
    await this.connect();
    const rs = await this.db.execute({
      sql: "SELECT * FROM words WHERE user_id = ? AND lower(trim(word)) = ? LIMIT 1",
      args: [userId, normalizeWord(word)],
    });
    return rs.rows[0] ? this.mapRow(rs.rows[0]) : undefined;
  }
  async add(userId: string, input: NewWord): Promise<Word> {
    await this.connect();
    const w = makeWord(input);
    await this.db.execute(insertStmt(w, userId));
    return w;
  }
  async addMany(userId: string, inputs: NewWord[]): Promise<Word[]> {
    await this.connect();
    const created = inputs.map(makeWord);
    if (created.length)
      await this.db.batch(
        created.map((w) => insertStmt(w, userId)),
        "write",
      );
    return created;
  }
  async update(
    userId: string,
    id: string,
    patch: Partial<Word>,
  ): Promise<Word | undefined> {
    await this.connect();
    const cur = await this.get(userId, id);
    if (!cur) return undefined;
    const next = { ...cur, ...patch, id };
    const r = toRow(next);
    const sets = HEADERS.filter((h) => h !== "id").map((h) => `"${h}" = ?`);
    await this.db.execute({
      sql: `UPDATE words SET ${sets.join(", ")} WHERE id = ? AND user_id = ?`,
      args: [
        ...HEADERS.filter((h) => h !== "id").map((h) => r[h]),
        id,
        userId,
      ],
    });
    return next;
  }
  async remove(userId: string, id: string): Promise<void> {
    await this.connect();
    await this.db.execute({
      sql: "DELETE FROM words WHERE id = ? AND user_id = ?",
      args: [id, userId],
    });
  }
  async logAttempt(userId: string, a: Attempt): Promise<void> {
    await this.connect();
    await this.db.execute({
      sql: "INSERT INTO attempts (ts, word_id, exercise_type, result, user_id) VALUES (?,?,?,?,?)",
      args: [a.ts, a.word_id, a.exercise_type, a.result, userId],
    });
  }
  async attempts(userId: string): Promise<Attempt[]> {
    await this.connect();
    const rs = await this.db.execute({
      sql: "SELECT ts, word_id, exercise_type, result FROM attempts WHERE user_id = ? ORDER BY ts",
      args: [userId],
    });
    return rs.rows.map((r: any) => ({
      word_id: String(r.word_id ?? ""),
      exercise_type: String(r.exercise_type ?? ""),
      result: String(r.result ?? "incorrect") as Attempt["result"],
      ts: Number(r.ts ?? 0),
    }));
  }
  async addQuestions(userId: string, qs: Question[]): Promise<void> {
    await this.connect();
    if (!qs.length) return;
    await this.db.batch(
      qs.map((q) => ({
        sql: "INSERT OR REPLACE INTO questions (id, word_id, type, direction, payload, answer, last_shown, user_id) VALUES (?,?,?,?,?,?,0,?)",
        args: [q.id, q.word_id, q.type, q.direction, q.payload, q.answer, userId],
      })),
      "write",
    );
  }
  async pickQuestion(
    userId: string,
    wordId: string,
    type: string,
  ): Promise<Question | undefined> {
    await this.connect();
    const rs = await this.db.execute({
      sql: "SELECT * FROM questions WHERE user_id=? AND word_id=? AND type=? ORDER BY last_shown ASC, RANDOM() LIMIT 1",
      args: [userId, wordId, type],
    });
    const r: any = rs.rows[0];
    if (!r) return undefined;
    await this.db.execute({
      sql: "UPDATE questions SET last_shown=? WHERE id=? AND user_id=?",
      args: [Date.now(), String(r.id), userId],
    });
    return {
      id: String(r.id),
      word_id: String(r.word_id),
      type: String(r.type) as Question["type"],
      direction: String(r.direction ?? ""),
      payload: String(r.payload ?? ""),
      answer: String(r.answer ?? ""),
    };
  }
  async questionCount(userId: string): Promise<number> {
    await this.connect();
    const rs = await this.db.execute({
      sql: "SELECT COUNT(*) c FROM questions WHERE user_id = ?",
      args: [userId],
    });
    return Number(rs.rows[0]?.c ?? 0);
  }
  async questionWordIds(userId: string): Promise<string[]> {
    await this.connect();
    const rs = await this.db.execute({
      sql: "SELECT DISTINCT word_id FROM questions WHERE user_id = ?",
      args: [userId],
    });
    return rs.rows.map((r: any) => String(r.word_id));
  }
}

/** Add a column if it doesn't already exist (SQLite has no IF NOT EXISTS for ADD COLUMN). */
async function addColumn(db: any, table: string, colDef: string): Promise<void> {
  try {
    await db.execute(`ALTER TABLE ${table} ADD COLUMN ${colDef}`);
  } catch {
    /* column already exists */
  }
}

function insertStmt(w: Word, userId: string) {
  const r = toRow(w);
  const cols = [...HEADERS, "user_id"];
  return {
    sql: `INSERT INTO words (${cols.map((h) => `"${h}"`).join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
    args: [...HEADERS.map((h) => r[h]), userId],
  };
}

/**
 * Bind a raw (userId-first) store to one user, producing the ScopedStore the app
 * calls. Works for both backends: SheetStore's raw methods ignore the id.
 */
function makeScoped(raw: any, userId: string): ScopedStore {
  return {
    all: () => raw.all(userId),
    get: (id) => raw.get(userId, id),
    findByWord: (word) => raw.findByWord(userId, word),
    add: (word) => raw.add(userId, word),
    addMany: (words) => raw.addMany(userId, words),
    update: (id, patch) => raw.update(userId, id, patch),
    remove: (id) => raw.remove(userId, id),
    logAttempt: (a) => raw.logAttempt(userId, a),
    attempts: () => raw.attempts(userId),
    addQuestions: (qs) => raw.addQuestions(userId, qs),
    pickQuestion: (wordId, type) => raw.pickQuestion(userId, wordId, type),
    questionCount: () => raw.questionCount(userId),
    questionWordIds: () => raw.questionWordIds(userId),
    backend: () => raw.backend(),
  };
}

/* ───────────────────────────  Google Sheet  ────────────────────────── */

type GRow = {
  get(k: string): string | undefined;
  set(k: string, v: string): void;
  save(): Promise<void>;
  delete(): Promise<void>;
};

/*
 * SINGLE-USER backend. One Sheet == one user, so the raw methods accept a userId
 * to satisfy the shared shape but deliberately ignore it. Do not use the Sheet
 * backend for a multi-tenant deploy — use SqliteStore/Turso.
 */
class SheetStore implements Store {
  private cache: Word[] | null = null;
  private rows = new Map<string, GRow>();
  private sheet: any = null;
  private doc: any = null;
  private attemptsSheet: any = null;
  private attemptCache: Attempt[] | null = null;
  private questionsSheet: any = null;
  private questionCache: Question[] | null = null;
  private ready: Promise<void> | null = null;

  backend(): "sheet" {
    return "sheet";
  }

  forUser(userId: string): ScopedStore {
    return makeScoped(this, userId);
  }

  private async connect(): Promise<void> {
    if (this.ready) return this.ready;
    this.ready = (async () => {
      const { GoogleSpreadsheet } = await import("google-spreadsheet");
      const { JWT } = await import("google-auth-library");
      const creds = getSheetCreds();
      const jwt = new JWT({
        email: creds.client_email,
        key: creds.private_key,
        scopes: ["https://www.googleapis.com/auth/spreadsheets"],
      });
      const doc = new GoogleSpreadsheet(process.env.SHEET_ID!, jwt);
      await doc.loadInfo();
      let sheet = doc.sheetsByTitle["Words"];
      if (!sheet) {
        sheet = await doc.addSheet({ title: "Words", headerValues: [...HEADERS] });
      }
      this.sheet = sheet;
      this.doc = doc;
      const rows = await sheet.getRows();
      const words: Word[] = [];
      for (const r of rows) {
        const w = fromRow((k) => r.get(k));
        words.push(w);
        this.rows.set(w.id, r as unknown as GRow);
      }
      this.cache = words;
    })();
    return this.ready;
  }
  private async load(): Promise<Word[]> {
    await this.connect();
    return this.cache!;
  }
  async all(_userId: string): Promise<Word[]> {
    return [...(await this.load())];
  }
  async get(_userId: string, id: string): Promise<Word | undefined> {
    return (await this.load()).find((w) => w.id === id);
  }
  async findByWord(_userId: string, word: string): Promise<Word | undefined> {
    const n = normalizeWord(word);
    return (await this.load()).find((w) => normalizeWord(w.word) === n);
  }
  async add(_userId: string, input: NewWord): Promise<Word> {
    await this.connect();
    const w = makeWord(input);
    const row = await this.sheet.addRow(toRow(w));
    this.cache!.push(w);
    this.rows.set(w.id, row as unknown as GRow);
    return w;
  }
  async addMany(_userId: string, inputs: NewWord[]): Promise<Word[]> {
    await this.connect();
    const created = inputs.map(makeWord);
    const rows = await this.sheet.addRows(created.map(toRow));
    created.forEach((w, i) => {
      this.cache!.push(w);
      this.rows.set(w.id, rows[i] as unknown as GRow);
    });
    return created;
  }
  async update(
    _userId: string,
    id: string,
    patch: Partial<Word>,
  ): Promise<Word | undefined> {
    await this.connect();
    const i = this.cache!.findIndex((w) => w.id === id);
    if (i === -1) return undefined;
    const next = { ...this.cache![i], ...patch, id };
    this.cache![i] = next;
    const row = this.rows.get(id);
    if (row) {
      const r = toRow(next);
      for (const k of HEADERS) row.set(k, r[k]);
      await row.save();
    }
    return next;
  }
  async remove(_userId: string, id: string): Promise<void> {
    await this.connect();
    const i = this.cache!.findIndex((w) => w.id === id);
    if (i !== -1) this.cache!.splice(i, 1);
    const row = this.rows.get(id);
    if (row) {
      await row.delete();
      this.rows.delete(id);
    }
  }
  private async ensureAttempts(): Promise<void> {
    await this.connect();
    if (this.attemptsSheet) return;
    let s = this.doc.sheetsByTitle["Attempts"];
    if (!s)
      s = await this.doc.addSheet({
        title: "Attempts",
        headerValues: ["ts", "word_id", "exercise_type", "result"],
      });
    this.attemptsSheet = s;
    const rows = await s.getRows();
    this.attemptCache = rows.map((r: any) => ({
      ts: Number(r.get("ts") || 0),
      word_id: r.get("word_id") || "",
      exercise_type: r.get("exercise_type") || "",
      result: (r.get("result") || "incorrect") as Attempt["result"],
    }));
  }
  async logAttempt(_userId: string, a: Attempt): Promise<void> {
    await this.ensureAttempts();
    await this.attemptsSheet.addRow({
      ts: String(a.ts),
      word_id: a.word_id,
      exercise_type: a.exercise_type,
      result: a.result,
    });
    this.attemptCache!.push(a);
  }
  async attempts(_userId: string): Promise<Attempt[]> {
    await this.ensureAttempts();
    return [...this.attemptCache!];
  }
  private async ensureQuestions(): Promise<void> {
    await this.connect();
    if (this.questionsSheet) return;
    let s = this.doc.sheetsByTitle["Questions"];
    if (!s)
      s = await this.doc.addSheet({
        title: "Questions",
        headerValues: ["id", "word_id", "type", "direction", "payload", "answer"],
      });
    this.questionsSheet = s;
    const rows = await s.getRows();
    this.questionCache = rows.map((r: any) => ({
      id: r.get("id") || "",
      word_id: r.get("word_id") || "",
      type: (r.get("type") || "cloze") as Question["type"],
      direction: r.get("direction") || "",
      payload: r.get("payload") || "",
      answer: r.get("answer") || "",
    }));
  }
  async addQuestions(_userId: string, qs: Question[]): Promise<void> {
    await this.ensureQuestions();
    if (!qs.length) return;
    await this.questionsSheet.addRows(qs.map((q) => ({ ...q })));
    this.questionCache!.push(...qs);
  }
  async pickQuestion(
    _userId: string,
    wordId: string,
    type: string,
  ): Promise<Question | undefined> {
    await this.ensureQuestions();
    const pool = this.questionCache!.filter(
      (q) => q.word_id === wordId && q.type === type,
    );
    return pool.length ? pool[Math.floor(Math.random() * pool.length)] : undefined;
  }
  async questionCount(_userId: string): Promise<number> {
    await this.ensureQuestions();
    return this.questionCache!.length;
  }
  async questionWordIds(_userId: string): Promise<string[]> {
    await this.ensureQuestions();
    return [...new Set(this.questionCache!.map((q) => q.word_id))];
  }
}

/* ─────────────────────────────  factory  ───────────────────────────── */

interface Creds {
  client_email: string;
  private_key: string;
}

function getSheetCreds(): Creds {
  const json = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (json) {
    const parsed = JSON.parse(json);
    return { client_email: parsed.client_email, private_key: parsed.private_key };
  }
  return {
    client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "",
    private_key: (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
  };
}

export function hasSheetConfig(): boolean {
  const hasCreds =
    !!process.env.GOOGLE_SERVICE_ACCOUNT_JSON ||
    (!!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL &&
      !!process.env.GOOGLE_PRIVATE_KEY);
  return hasCreds && !!process.env.SHEET_ID;
}

let instance: Store | null = null;
export function getStore(): Store {
  if (instance) return instance;
  instance = hasSheetConfig() ? new SheetStore() : new SqliteStore();
  return instance;
}
