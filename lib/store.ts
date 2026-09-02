import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import type {
  Word,
  WordListItem,
  Attempt,
  Question,
  Collection,
  Progress,
  Visibility,
} from "./types";
import { SYSTEM_OWNER, canEdit, ownerIdFor } from "./auth/user";
import { getDb, CONTENT_COLS } from "./db";
// NOTE: writing prompts live in lib/writing/store.ts and follow the same
// owner_id/visibility model as collections. Vocab data below is split into shared
// CONTENT (words + questions, keyed by id) and per-user PROGRESS (user_words +
// user_question_state). See the header comment below.

/*
 * Storage lives behind this one interface. Two backends:
 *   - SqliteStore : libSQL/SQLite. Local = a fast file (.data/lexi.db, zero setup);
 *                   the SAME client talks to Turso (hosted libSQL) when deployed.
 *                   This is the default and the multi-tenant (deploy) backend.
 *   - SheetStore  : Google Sheet via a service account — a single-user local
 *                   workflow ("open my words in a spreadsheet"). NOT multi-tenant:
 *                   it ignores the user scope (one sheet = one user) and does NOT
 *                   implement the content/progress split (progress stays inline on
 *                   the row — equivalent for a single user). See needs-decision note.
 * getStore() picks the backend from env and caches a single instance.
 *
 * CONTENT vs PROGRESS. A word is split into two kinds of facts:
 *   - CONTENT (shared once): the word text/meaning/examples and its question bank.
 *     `words.owner_id` gates EDITING only (`__system__` = public catalog; a user id
 *     = that user's personal word). Content is otherwise global.
 *   - PROGRESS (per user): `user_words(user_id, word_id, stage, …)` is the only
 *     per-user vocab progress. "Studying a word" = having a row here; no row means
 *     stage `new`. Per-user question recency lives in `user_question_state`.
 * The store JOINs the two and hydrates each Word's `.stage`/progress before the
 * pure engine (`lib/engine.ts`) ever sees it — the engine stays content-agnostic.
 *
 * Every scoped method is bound to one user via getStore().forUser(userId), so
 * user scoping is impossible to forget at a call site. Editing shared content is
 * gated separately by owner_id (see `canEdit`) — studying grants no edit rights.
 */

/** Thrown when a caller tries to edit content/collection they do not own. */
export class ForbiddenError extends Error {
  constructor(message = "forbidden") {
    super(message);
    this.name = "ForbiddenError";
  }
}

/** A user-scoped view of the store — every method operates on one user's data. */
export interface ScopedStore {
  /** Words this user is STUDYING (has a user_words row for), hydrated with progress. */
  all(): Promise<Word[]>;
  /** Like `all()` but returns only the slim fields the Library list view needs
   *  (see WordListItem) — skips the heavy text columns so the payload stays small. */
  listLite(): Promise<WordListItem[]>;
  /** A single visible content word (public catalog or this user's own), hydrated
   *  with this user's progress (defaults to stage `new` if not yet studied). */
  get(id: string): Promise<Word | undefined>;
  findByWord(word: string): Promise<Word | undefined>;
  add(word: NewWord): Promise<Word>;
  addMany(words: NewWord[]): Promise<Word[]>;
  /** Edit a word's CONTENT. Throws ForbiddenError unless the caller owns it (the
   *  owner/admin may edit `__system__` catalog words). Progress fields are ignored. */
  update(id: string, patch: Partial<Word>): Promise<Word | undefined>;
  /** Upsert this user's PROGRESS on a word (studying it). No edit rights required. */
  setProgress(wordId: string, progress: Progress): Promise<Word | undefined>;
  /** Atomically upsert progress AND log the attempt (one write batch on SQLite). */
  recordResult(wordId: string, progress: Progress, attempt: Attempt): Promise<Word | undefined>;
  remove(id: string): Promise<void>;
  logAttempt(a: Attempt): Promise<void>;
  attempts(): Promise<Attempt[]>;
  /** Candidates for the practice picker: this user's studied words, or — when a
   *  collection is given — that collection's shared words hydrated with progress
   *  (unstudied members appear as stage `new`, so public packs are practisable). */
  practiceCandidates(collectionId?: string): Promise<Word[]>;
  addQuestions(qs: Question[]): Promise<void>;
  /** Least-recently-shown (for THIS user) question of a type for a word, marking it shown. */
  pickQuestion(wordId: string, type: string): Promise<Question | undefined>;
  /** Total questions in the shared bank. */
  questionCount(): Promise<number>;
  /** Distinct word_ids that already have at least one bank question (shared). */
  questionWordIds(): Promise<string[]>;
  // ── collections (many-to-many word grouping) ─────────────────────────
  /** The user's own (private) collections PLUS every public one, each with `count`
   *  and `mine` (whether the caller can edit it), newest first. */
  collections(): Promise<Collection[]>;
  createCollection(input: {
    name: string;
    description?: string;
    emoji?: string;
  }): Promise<Collection>;
  updateCollection(
    id: string,
    patch: Partial<Pick<Collection, "name" | "description" | "emoji">>,
  ): Promise<Collection | undefined>;
  /** Owner/admin-only: mark a collection public (system-owned) or private. */
  setCollectionVisibility(
    id: string,
    visibility: Visibility,
  ): Promise<Collection | undefined>;
  removeCollection(id: string): Promise<void>;
  /** Bulk-adopt a collection: insert user_words rows for its members (no content
   *  is copied). Returns the number of member words. */
  adoptCollection(id: string): Promise<number>;
  /** Ids of the words in a (visible) collection — used to scope the practice picker. */
  wordIdsInCollection(collectionId: string): Promise<string[]>;
  /** Every word↔collection link in collections visible to the caller. */
  memberships(): Promise<Array<{ word_id: string; collection_id: string }>>;
  /** Add/remove words in a collection the caller can edit. */
  setCollectionMembers(
    collectionId: string,
    change: { add?: string[]; remove?: string[] },
  ): Promise<void>;
  /** Replace the set of caller-editable collections a single word belongs to. */
  setWordCollections(wordId: string, collectionIds: string[]): Promise<void>;
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
    owner_id: input.owner_id ?? "",
    stage: input.stage ?? "new",
    times_seen: input.times_seen ?? 0,
    recent_results: input.recent_results ?? [],
    last_seen_at: input.last_seen_at ?? null,
    created_at: input.created_at ?? now,
  };
}

/* ─────────────────────  Row (de)serialization  ─────────────────────── */

/** Full-word headers (content + progress). Used by the single-user Sheet backend,
 *  which keeps progress inline on the row. SQLite uses CONTENT_COLS + user_words. */
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

// Shared-content columns of the `words` table: CONTENT_COLS, imported from lib/db.ts
// (the schema owner) so the DDL and the queries can never drift apart.

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
    owner_id: get("owner_id") || "",
    stage: (get("stage") as Word["stage"]) || "new",
    times_seen: Number(get("times_seen") || 0),
    recent_results: jsonArr(get("recent_results")) as Word["recent_results"],
    last_seen_at: get("last_seen_at") ? Number(get("last_seen_at")) : null,
    created_at: Number(get("created_at") || Date.now()),
  });
}

/* ───────────────────────────  SQLite / libSQL  ─────────────────────── */

// Explicit "w"-aliased content select + progress columns aliased to avoid name
// collisions with any legacy progress columns still on a migrated `words` table.
const W_CONTENT = CONTENT_COLS.map((c) => `w."${c}"`).join(", ") + ", w.owner_id";
const W_PROGRESS =
  "uw.stage AS p_stage, uw.times_seen AS p_times, uw.recent_results AS p_recent, uw.last_seen_at AS p_last";

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
    // One shared client per process (lib/db.ts); schema is migrated before it
    // resolves, so no DDL runs here.
    if (!this.db) this.db = await getDb();
  }

  /** Map a content+progress joined row (progress cols aliased p_*) into a Word. */
  private mapWord(row: any): Word {
    return makeWord({
      id: str(row.id),
      word: str(row.word),
      part_of_speech: str(row.part_of_speech),
      ipa: str(row.ipa),
      vi_meaning: str(row.vi_meaning),
      definition_en: str(row.definition_en),
      synonyms: jsonArr(strOrU(row.synonyms)),
      collocations: jsonArr(strOrU(row.collocations)),
      example_simple: str(row.example_simple),
      example_complex: str(row.example_complex),
      false_friend_note: str(row.false_friend_note),
      personal_note: str(row.personal_note),
      tags: jsonArr(strOrU(row.tags)),
      source: (str(row.source) as Word["source"]) || "manual",
      owner_id: str(row.owner_id),
      stage: (row.p_stage != null ? String(row.p_stage) : "new") as Word["stage"],
      times_seen: row.p_times != null ? Number(row.p_times) : 0,
      recent_results: jsonArr(strOrU(row.p_recent)) as Word["recent_results"],
      last_seen_at: row.p_last != null ? Number(row.p_last) : null,
      created_at: Number(row.created_at || Date.now()),
    });
  }

  async all(userId: string): Promise<Word[]> {
    await this.connect();
    const rs = await this.db.execute({
      sql: `SELECT ${W_CONTENT}, ${W_PROGRESS}
              FROM user_words uw JOIN words w ON w.id = uw.word_id
             WHERE uw.user_id = ?
             ORDER BY w.created_at DESC`,
      args: [userId],
    });
    return rs.rows.map((r: any) => this.mapWord(r));
  }

  async listLite(userId: string): Promise<WordListItem[]> {
    await this.connect();
    // Only the slim columns the Library list view needs — the heavy text fields
    // (definition, examples, notes, synonyms, collocations) are left on the row
    // and fetched per-word via get() when a row is expanded to edit.
    const rs = await this.db.execute({
      sql: `SELECT w."id", w."word", w."ipa", w."vi_meaning", w."tags",
                   w."created_at", ${W_PROGRESS}
              FROM user_words uw JOIN words w ON w.id = uw.word_id
             WHERE uw.user_id = ?
             ORDER BY w.created_at DESC`,
      args: [userId],
    });
    return rs.rows.map((r: any) => ({
      id: r.id,
      word: r.word || "",
      ipa: r.ipa || "",
      vi_meaning: r.vi_meaning || "",
      tags: jsonArr(r.tags),
      stage: (r.p_stage as WordListItem["stage"]) || "new",
      times_seen: Number(r.p_times || 0),
      recent_results: jsonArr(r.p_recent) as WordListItem["recent_results"],
      created_at: Number(r.created_at || Date.now()),
    }));
  }

  async get(userId: string, id: string): Promise<Word | undefined> {
    await this.connect();
    const rs = await this.db.execute({
      sql: `SELECT ${W_CONTENT}, ${W_PROGRESS}
              FROM words w
              LEFT JOIN user_words uw ON uw.word_id = w.id AND uw.user_id = ?
             WHERE w.id = ? AND (w.owner_id = ? OR w.owner_id = ?)
             LIMIT 1`,
      args: [userId, id, SYSTEM_OWNER, userId],
    });
    return rs.rows[0] ? this.mapWord(rs.rows[0]) : undefined;
  }

  async findByWord(userId: string, word: string): Promise<Word | undefined> {
    await this.connect();
    const rs = await this.db.execute({
      sql: `SELECT ${W_CONTENT}, ${W_PROGRESS}
              FROM words w
              LEFT JOIN user_words uw ON uw.word_id = w.id AND uw.user_id = ?
             WHERE lower(trim(w.word)) = ? AND (w.owner_id = ? OR w.owner_id = ?)
             LIMIT 1`,
      args: [userId, normalizeWord(word), SYSTEM_OWNER, userId],
    });
    return rs.rows[0] ? this.mapWord(rs.rows[0]) : undefined;
  }

  async add(userId: string, input: NewWord): Promise<Word> {
    await this.connect();
    const w = makeWord({ ...input, owner_id: ownerIdFor(userId) });
    await this.db.batch([contentInsert(w), userWordInsert(userId, w)], "write");
    return w;
  }

  async addMany(userId: string, inputs: NewWord[]): Promise<Word[]> {
    await this.connect();
    const created = inputs.map((i) => makeWord({ ...i, owner_id: ownerIdFor(userId) }));
    if (created.length) {
      const stmts: any[] = [];
      for (const w of created) {
        stmts.push(contentInsert(w));
        stmts.push(userWordInsert(userId, w));
      }
      await this.db.batch(stmts, "write");
    }
    return created;
  }

  /** Content edit — owner-gated. Progress fields in the patch are ignored. */
  async update(
    userId: string,
    id: string,
    patch: Partial<Word>,
  ): Promise<Word | undefined> {
    await this.connect();
    const owner = await this.ownerOf(id);
    if (owner === undefined) return undefined;
    if (!canEdit(userId, owner)) throw new ForbiddenError("cannot edit this word");
    const cur = await this.get(userId, id);
    if (!cur) return undefined;
    const next = { ...cur, ...patch, id, owner_id: owner };
    const r = toRow(next);
    const cols = CONTENT_COLS.filter((h) => h !== "id");
    await this.db.execute({
      sql: `UPDATE words SET ${cols.map((h) => `"${h}" = ?`).join(", ")} WHERE id = ?`,
      args: [...cols.map((h) => r[h]), id],
    });
    return this.get(userId, id);
  }

  /** Upsert this user's progress (studying the word). No edit rights required. */
  async setProgress(
    userId: string,
    wordId: string,
    progress: Progress,
  ): Promise<Word | undefined> {
    await this.connect();
    await this.db.execute({
      sql: `INSERT INTO user_words (user_id, word_id, stage, times_seen, recent_results, last_seen_at, added_at)
            VALUES (?,?,?,?,?,?,?)
            ON CONFLICT(user_id, word_id) DO UPDATE SET
              stage = excluded.stage,
              times_seen = excluded.times_seen,
              recent_results = excluded.recent_results,
              last_seen_at = excluded.last_seen_at`,
      args: [
        userId,
        wordId,
        progress.stage,
        progress.times_seen,
        JSON.stringify(progress.recent_results ?? []),
        progress.last_seen_at,
        Date.now(),
      ],
    });
    return this.get(userId, wordId);
  }

  /**
   * Upsert progress AND log the attempt in ONE write batch, so a practice
   * result can never persist the stage change but lose the attempt row (or
   * pay two lock acquisitions). Same statements as setProgress + logAttempt.
   */
  async recordResult(
    userId: string,
    wordId: string,
    progress: Progress,
    attempt: Attempt,
  ): Promise<Word | undefined> {
    await this.connect();
    await this.db.batch(
      [
        {
          sql: `INSERT INTO user_words (user_id, word_id, stage, times_seen, recent_results, last_seen_at, added_at)
                VALUES (?,?,?,?,?,?,?)
                ON CONFLICT(user_id, word_id) DO UPDATE SET
                  stage = excluded.stage,
                  times_seen = excluded.times_seen,
                  recent_results = excluded.recent_results,
                  last_seen_at = excluded.last_seen_at`,
          args: [
            userId,
            wordId,
            progress.stage,
            progress.times_seen,
            JSON.stringify(progress.recent_results ?? []),
            progress.last_seen_at,
            Date.now(),
          ],
        },
        {
          sql: "INSERT INTO attempts (ts, word_id, exercise_type, result, user_id) VALUES (?,?,?,?,?)",
          args: [attempt.ts, attempt.word_id, attempt.exercise_type, attempt.result, userId],
        },
      ],
      "write",
    );
    return this.get(userId, wordId);
  }

  async remove(userId: string, id: string): Promise<void> {
    await this.connect();
    const owner = await this.ownerOf(id);
    if (owner === undefined) return;
    if (canEdit(userId, owner)) {
      // Delete the shared content and everything hanging off it.
      await this.db.batch(
        [
          { sql: "DELETE FROM words WHERE id = ?", args: [id] },
          { sql: "DELETE FROM user_words WHERE word_id = ?", args: [id] },
          { sql: "DELETE FROM word_collections WHERE word_id = ?", args: [id] },
          {
            sql: "DELETE FROM user_question_state WHERE question_id IN (SELECT id FROM questions WHERE word_id = ?)",
            args: [id],
          },
          { sql: "DELETE FROM questions WHERE word_id = ?", args: [id] },
        ],
        "write",
      );
    } else {
      // Not the owner: "remove from my library" = stop studying + drop the word
      // from the caller's own collections. Shared content is untouched.
      await this.db.batch(
        [
          {
            sql: "DELETE FROM user_words WHERE user_id = ? AND word_id = ?",
            args: [userId, id],
          },
          {
            sql: `DELETE FROM word_collections WHERE word_id = ? AND collection_id IN
                   (SELECT id FROM collections WHERE owner_id = ?)`,
            args: [id, userId],
          },
        ],
        "write",
      );
    }
  }

  private async ownerOf(id: string): Promise<string | undefined> {
    const rs = await this.db.execute({
      sql: "SELECT owner_id FROM words WHERE id = ? LIMIT 1",
      args: [id],
    });
    return rs.rows[0] ? str(rs.rows[0].owner_id) : undefined;
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

  async practiceCandidates(userId: string, collectionId?: string): Promise<Word[]> {
    await this.connect();
    if (!collectionId) return this.all(userId);
    if (!(await this.collectionVisibleTo(userId, collectionId))) return [];
    const rs = await this.db.execute({
      sql: `SELECT ${W_CONTENT}, ${W_PROGRESS}
              FROM word_collections wc
              JOIN words w ON w.id = wc.word_id
              LEFT JOIN user_words uw ON uw.word_id = w.id AND uw.user_id = ?
             WHERE wc.collection_id = ?
             ORDER BY w.created_at DESC`,
      args: [userId, collectionId],
    });
    return rs.rows.map((r: any) => this.mapWord(r));
  }

  async addQuestions(_userId: string, qs: Question[]): Promise<void> {
    await this.connect();
    if (!qs.length) return;
    await this.db.batch(
      qs.map((q) => ({
        sql: "INSERT OR REPLACE INTO questions (id, word_id, type, direction, payload, answer) VALUES (?,?,?,?,?,?)",
        args: [q.id, q.word_id, q.type, q.direction, q.payload, q.answer],
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
      sql: `SELECT q.id, q.word_id, q.type, q.direction, q.payload, q.answer,
                   COALESCE(uqs.last_shown, 0) AS ls
              FROM questions q
              LEFT JOIN user_question_state uqs
                     ON uqs.question_id = q.id AND uqs.user_id = ?
             WHERE q.word_id = ? AND q.type = ?
             ORDER BY ls ASC, RANDOM() LIMIT 1`,
      args: [userId, wordId, type],
    });
    const r: any = rs.rows[0];
    if (!r) return undefined;
    await this.db.execute({
      sql: `INSERT INTO user_question_state (user_id, question_id, last_shown) VALUES (?,?,?)
            ON CONFLICT(user_id, question_id) DO UPDATE SET last_shown = excluded.last_shown`,
      args: [userId, String(r.id), Date.now()],
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

  async questionCount(_userId: string): Promise<number> {
    await this.connect();
    const rs = await this.db.execute("SELECT COUNT(*) c FROM questions");
    return Number(rs.rows[0]?.c ?? 0);
  }

  async questionWordIds(_userId: string): Promise<string[]> {
    await this.connect();
    const rs = await this.db.execute("SELECT DISTINCT word_id FROM questions");
    return rs.rows.map((r: any) => String(r.word_id));
  }

  // ── collections ──────────────────────────────────────────────────────
  private async collectionOwner(id: string): Promise<string | undefined> {
    const rs = await this.db.execute({
      sql: "SELECT owner_id FROM collections WHERE id = ? LIMIT 1",
      args: [id],
    });
    return rs.rows[0] ? str(rs.rows[0].owner_id) : undefined;
  }

  private async collectionVisibleTo(
    userId: string,
    id: string,
  ): Promise<boolean> {
    const rs = await this.db.execute({
      sql: "SELECT owner_id, visibility FROM collections WHERE id = ? LIMIT 1",
      args: [id],
    });
    const c: any = rs.rows[0];
    if (!c) return false;
    return str(c.owner_id) === userId || str(c.visibility) === "public";
  }

  async collections(userId: string): Promise<Collection[]> {
    await this.connect();
    const rs = await this.db.execute({
      sql: `SELECT c.id, c.name, c.description, c.emoji, c.created_at, c.owner_id, c.visibility,
                   COUNT(wc.word_id) AS cnt
              FROM collections c
              LEFT JOIN word_collections wc ON wc.collection_id = c.id
             WHERE c.owner_id = ? OR c.visibility = 'public'
             GROUP BY c.id
             ORDER BY c.created_at DESC`,
      args: [userId],
    });
    return rs.rows.map((r: any) => mapCollection(r, Number(r.cnt ?? 0), userId));
  }

  async createCollection(
    userId: string,
    input: { name: string; description?: string; emoji?: string },
  ): Promise<Collection> {
    await this.connect();
    const c: Collection = {
      id: randomUUID(),
      name: input.name.trim(),
      description: input.description ?? "",
      emoji: input.emoji ?? "",
      created_at: Date.now(),
      owner_id: userId,
      visibility: "private",
    };
    await this.db.execute({
      sql: "INSERT INTO collections (id, name, description, emoji, created_at, owner_id, visibility) VALUES (?,?,?,?,?,?,?)",
      args: [c.id, c.name, c.description, c.emoji, c.created_at, c.owner_id, c.visibility],
    });
    return { ...c, count: 0, mine: true };
  }

  async updateCollection(
    userId: string,
    id: string,
    patch: Partial<Pick<Collection, "name" | "description" | "emoji">>,
  ): Promise<Collection | undefined> {
    await this.connect();
    const rs = await this.db.execute({
      sql: "SELECT * FROM collections WHERE id = ? LIMIT 1",
      args: [id],
    });
    const cur: any = rs.rows[0];
    if (!cur) return undefined;
    if (!canEdit(userId, str(cur.owner_id)))
      throw new ForbiddenError("cannot edit this collection");
    const next = {
      name: (patch.name ?? String(cur.name ?? "")).trim(),
      description: patch.description ?? String(cur.description ?? ""),
      emoji: patch.emoji ?? String(cur.emoji ?? ""),
    };
    await this.db.execute({
      sql: "UPDATE collections SET name = ?, description = ?, emoji = ? WHERE id = ?",
      args: [next.name, next.description, next.emoji, id],
    });
    return mapCollection(
      { ...cur, ...next },
      await this.collectionCount(id),
      userId,
    );
  }

  async setCollectionVisibility(
    userId: string,
    id: string,
    visibility: Visibility,
  ): Promise<Collection | undefined> {
    await this.connect();
    const rs = await this.db.execute({
      sql: "SELECT * FROM collections WHERE id = ? LIMIT 1",
      args: [id],
    });
    const cur: any = rs.rows[0];
    if (!cur) return undefined;
    // Publishing is an owner/admin-only act, and it must keep the "public ⇒
    // system-owned" invariant. A private collection reverts to the admin owner.
    if (!canEdit(userId, str(cur.owner_id)))
      throw new ForbiddenError("cannot change visibility of this collection");
    const owner_id = visibility === "public" ? SYSTEM_OWNER : userId;
    await this.db.execute({
      sql: "UPDATE collections SET visibility = ?, owner_id = ? WHERE id = ?",
      args: [visibility, owner_id, id],
    });
    return mapCollection(
      { ...cur, visibility, owner_id },
      await this.collectionCount(id),
      userId,
    );
  }

  private async collectionCount(id: string): Promise<number> {
    const rs = await this.db.execute({
      sql: "SELECT COUNT(*) c FROM word_collections WHERE collection_id = ?",
      args: [id],
    });
    return Number(rs.rows[0]?.c ?? 0);
  }

  async removeCollection(userId: string, id: string): Promise<void> {
    await this.connect();
    const owner = await this.collectionOwner(id);
    if (owner === undefined) return;
    if (!canEdit(userId, owner))
      throw new ForbiddenError("cannot delete this collection");
    await this.db.batch(
      [
        { sql: "DELETE FROM word_collections WHERE collection_id = ?", args: [id] },
        { sql: "DELETE FROM collections WHERE id = ?", args: [id] },
      ],
      "write",
    );
  }

  async adoptCollection(userId: string, id: string): Promise<number> {
    await this.connect();
    if (!(await this.collectionVisibleTo(userId, id))) return 0;
    const members = await this.wordIdsInCollection(userId, id);
    if (members.length) {
      const now = Date.now();
      await this.db.batch(
        members.map((wid) => ({
          sql: `INSERT OR IGNORE INTO user_words
                 (user_id, word_id, stage, times_seen, recent_results, last_seen_at, added_at)
                 VALUES (?,?, 'new', 0, '[]', NULL, ?)`,
          args: [userId, wid, now],
        })),
        "write",
      );
    }
    return members.length;
  }

  async wordIdsInCollection(userId: string, collectionId: string): Promise<string[]> {
    await this.connect();
    if (!(await this.collectionVisibleTo(userId, collectionId))) return [];
    const rs = await this.db.execute({
      sql: "SELECT word_id FROM word_collections WHERE collection_id = ?",
      args: [collectionId],
    });
    return rs.rows.map((r: any) => String(r.word_id));
  }

  async memberships(
    userId: string,
  ): Promise<Array<{ word_id: string; collection_id: string }>> {
    await this.connect();
    const rs = await this.db.execute({
      sql: `SELECT wc.word_id, wc.collection_id
              FROM word_collections wc
              JOIN collections c ON c.id = wc.collection_id
             WHERE c.owner_id = ? OR c.visibility = 'public'`,
      args: [userId],
    });
    return rs.rows.map((r: any) => ({
      word_id: String(r.word_id),
      collection_id: String(r.collection_id),
    }));
  }

  async setCollectionMembers(
    userId: string,
    collectionId: string,
    change: { add?: string[]; remove?: string[] },
  ): Promise<void> {
    await this.connect();
    const owner = await this.collectionOwner(collectionId);
    if (owner === undefined) return;
    if (!canEdit(userId, owner))
      throw new ForbiddenError("cannot modify this collection");
    const stmts: { sql: string; args: any[] }[] = [];
    for (const wid of change.add ?? [])
      stmts.push({
        sql: "INSERT OR IGNORE INTO word_collections (word_id, collection_id) VALUES (?,?)",
        args: [wid, collectionId],
      });
    for (const wid of change.remove ?? [])
      stmts.push({
        sql: "DELETE FROM word_collections WHERE word_id = ? AND collection_id = ?",
        args: [wid, collectionId],
      });
    if (stmts.length) await this.db.batch(stmts, "write");
  }

  async setWordCollections(
    userId: string,
    wordId: string,
    collectionIds: string[],
  ): Promise<void> {
    await this.connect();
    // Only touch collections the caller can edit — never wipe a public pack's
    // membership because the caller happened to see it. Clear this word from all
    // caller-editable collections, then re-add the (editable) targets.
    const editable = [...(await this.editableCollectionIds(userId))];
    const targets = collectionIds.filter((cid) => editable.includes(cid));
    const stmts: { sql: string; args: any[] }[] = [];
    if (editable.length)
      stmts.push({
        sql: `DELETE FROM word_collections
               WHERE word_id = ? AND collection_id IN (${editable.map(() => "?").join(",")})`,
        args: [wordId, ...editable],
      });
    for (const cid of targets)
      stmts.push({
        sql: "INSERT OR IGNORE INTO word_collections (word_id, collection_id) VALUES (?,?)",
        args: [wordId, cid],
      });
    if (stmts.length) await this.db.batch(stmts, "write");
  }

  private async editableCollectionIds(userId: string): Promise<Set<string>> {
    // The caller owns these; the owner/admin additionally owns __system__ packs.
    const rs = await this.db.execute({
      sql: "SELECT id, owner_id FROM collections",
      args: [],
    });
    const set = new Set<string>();
    for (const r of rs.rows as any[])
      if (canEdit(userId, str(r.owner_id))) set.add(String(r.id));
    return set;
  }
}

function str(v: any): string {
  return v == null ? "" : String(v);
}
function strOrU(v: any): string | undefined {
  return v == null ? undefined : String(v);
}

/** Row → Collection (shared by both backends). `viewerId` sets `mine`. */
function mapCollection(r: any, count: number, viewerId: string): Collection {
  const owner_id = str(r.owner_id);
  return {
    id: String(r.id),
    name: String(r.name ?? ""),
    description: String(r.description ?? ""),
    emoji: String(r.emoji ?? ""),
    created_at: Number(r.created_at ?? 0),
    owner_id,
    visibility: (String(r.visibility ?? "private") as Visibility) || "private",
    count,
    mine: canEdit(viewerId, owner_id),
  };
}

/** Add a column if it doesn't already exist (SQLite has no IF NOT EXISTS for ADD COLUMN). */
async function addColumn(db: any, table: string, colDef: string): Promise<void> {
  try {
    await db.execute(`ALTER TABLE ${table} ADD COLUMN ${colDef}`);
  } catch {
    /* column already exists */
  }
}

/** INSERT for the shared content of a word. */
function contentInsert(w: Word) {
  const r = toRow(w);
  const cols = [...CONTENT_COLS, "owner_id"];
  return {
    sql: `INSERT INTO words (${cols.map((h) => `"${h}"`).join(", ")}) VALUES (${cols
      .map(() => "?")
      .join(", ")})`,
    args: [...CONTENT_COLS.map((h) => r[h]), w.owner_id],
  };
}

/** INSERT for a user's initial progress on a word (studying it). */
function userWordInsert(userId: string, w: Word) {
  return {
    sql: `INSERT OR IGNORE INTO user_words
           (user_id, word_id, stage, times_seen, recent_results, last_seen_at, added_at)
           VALUES (?,?,?,?,?,?,?)`,
    args: [
      userId,
      w.id,
      w.stage,
      w.times_seen,
      JSON.stringify(w.recent_results),
      w.last_seen_at,
      w.created_at,
    ],
  };
}

/**
 * Bind a raw (userId-first) store to one user, producing the ScopedStore the app
 * calls. Works for both backends: SheetStore's raw methods ignore the id.
 */
function makeScoped(raw: any, userId: string): ScopedStore {
  return {
    all: () => raw.all(userId),
    listLite: () => raw.listLite(userId),
    get: (id) => raw.get(userId, id),
    findByWord: (word) => raw.findByWord(userId, word),
    add: (word) => raw.add(userId, word),
    addMany: (words) => raw.addMany(userId, words),
    update: (id, patch) => raw.update(userId, id, patch),
    setProgress: (wordId, progress) => raw.setProgress(userId, wordId, progress),
    recordResult: (wordId, progress, attempt) =>
      raw.recordResult(userId, wordId, progress, attempt),
    remove: (id) => raw.remove(userId, id),
    logAttempt: (a) => raw.logAttempt(userId, a),
    attempts: () => raw.attempts(userId),
    practiceCandidates: (cid) => raw.practiceCandidates(userId, cid),
    addQuestions: (qs) => raw.addQuestions(userId, qs),
    pickQuestion: (wordId, type) => raw.pickQuestion(userId, wordId, type),
    questionCount: () => raw.questionCount(userId),
    questionWordIds: () => raw.questionWordIds(userId),
    // collections
    collections: () => raw.collections(userId),
    createCollection: (input) => raw.createCollection(userId, input),
    updateCollection: (id, patch) => raw.updateCollection(userId, id, patch),
    setCollectionVisibility: (id, v) => raw.setCollectionVisibility(userId, id, v),
    removeCollection: (id) => raw.removeCollection(userId, id),
    adoptCollection: (id) => raw.adoptCollection(userId, id),
    wordIdsInCollection: (cid) => raw.wordIdsInCollection(userId, cid),
    memberships: () => raw.memberships(userId),
    setCollectionMembers: (cid, change) =>
      raw.setCollectionMembers(userId, cid, change),
    setWordCollections: (wordId, cids) =>
      raw.setWordCollections(userId, wordId, cids),
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
 * to satisfy the shared shape but deliberately ignore it. It does NOT implement
 * the content/progress split (progress stays inline on the row — equivalent for
 * one user) or public collections (all collections are private, owned by the
 * single user). Do not use the Sheet backend for a multi-tenant deploy — use
 * SqliteStore/Turso. See the needs-decision note in the PR.
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
  private collectionsSheet: any = null;
  private membersSheet: any = null;
  private collectionCache: Collection[] | null = null;
  private memberCache: Array<{ word_id: string; collection_id: string }> | null =
    null;
  private collectionRows = new Map<string, GRow>();
  private memberRows: GRow[] | null = null;
  private ready: Promise<void> | null = null;

  backend(): "sheet" {
    return "sheet";
  }

  forUser(userId: string): ScopedStore {
    return makeScoped(this, userId);
  }

  /** Stamp the single user as owner so `canEdit` passes (Sheet owns everything). */
  private own(w: Word, userId: string): Word {
    return { ...w, owner_id: userId };
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
  async all(userId: string): Promise<Word[]> {
    return (await this.load()).map((w) => this.own(w, userId));
  }
  // Single-user local backend — no perf concern, so just trim full rows.
  async listLite(userId: string): Promise<WordListItem[]> {
    return (await this.all(userId)).map((w) => ({
      id: w.id,
      word: w.word,
      ipa: w.ipa,
      vi_meaning: w.vi_meaning,
      tags: w.tags,
      stage: w.stage,
      times_seen: w.times_seen,
      recent_results: w.recent_results,
      created_at: w.created_at,
    }));
  }
  async get(userId: string, id: string): Promise<Word | undefined> {
    const w = (await this.load()).find((x) => x.id === id);
    return w ? this.own(w, userId) : undefined;
  }
  async findByWord(userId: string, word: string): Promise<Word | undefined> {
    const n = normalizeWord(word);
    const w = (await this.load()).find((x) => normalizeWord(x.word) === n);
    return w ? this.own(w, userId) : undefined;
  }
  async add(userId: string, input: NewWord): Promise<Word> {
    await this.connect();
    const w = makeWord({ ...input, owner_id: userId });
    const row = await this.sheet.addRow(toRow(w));
    this.cache!.push(w);
    this.rows.set(w.id, row as unknown as GRow);
    return this.own(w, userId);
  }
  async addMany(userId: string, inputs: NewWord[]): Promise<Word[]> {
    await this.connect();
    const created = inputs.map((i) => makeWord({ ...i, owner_id: userId }));
    const rows = await this.sheet.addRows(created.map(toRow));
    created.forEach((w, i) => {
      this.cache!.push(w);
      this.rows.set(w.id, rows[i] as unknown as GRow);
    });
    return created.map((w) => this.own(w, userId));
  }
  async update(
    userId: string,
    id: string,
    patch: Partial<Word>,
  ): Promise<Word | undefined> {
    return this.applyPatch(userId, id, patch);
  }
  async setProgress(
    userId: string,
    wordId: string,
    progress: Progress,
  ): Promise<Word | undefined> {
    return this.applyPatch(userId, wordId, progress);
  }
  /** Sheets has no batch write; sequential is the best atomicity available. */
  async recordResult(
    userId: string,
    wordId: string,
    progress: Progress,
    attempt: Attempt,
  ): Promise<Word | undefined> {
    const w = await this.applyPatch(userId, wordId, progress);
    await this.logAttempt(userId, attempt);
    return w;
  }
  private async applyPatch(
    userId: string,
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
    return this.own(next, userId);
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
    if (this.memberCache) await this.removeMemberRows((m) => m.word_id === id);
  }
  async practiceCandidates(userId: string, collectionId?: string): Promise<Word[]> {
    if (!collectionId) return this.all(userId);
    const memberIds = new Set(await this.wordIdsInCollection(userId, collectionId));
    return (await this.load())
      .filter((w) => memberIds.has(w.id))
      .map((w) => this.own(w, userId));
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

  private async ensureCollections(): Promise<void> {
    await this.connect();
    if (this.collectionsSheet && this.membersSheet) return;
    let cs = this.doc.sheetsByTitle["Collections"];
    if (!cs)
      cs = await this.doc.addSheet({
        title: "Collections",
        headerValues: ["id", "name", "description", "emoji", "created_at"],
      });
    this.collectionsSheet = cs;
    let ms = this.doc.sheetsByTitle["WordCollections"];
    if (!ms)
      ms = await this.doc.addSheet({
        title: "WordCollections",
        headerValues: ["word_id", "collection_id"],
      });
    this.membersSheet = ms;
    const crows = await cs.getRows();
    this.collectionCache = crows.map((r: any) => ({
      id: r.get("id") || "",
      name: r.get("name") || "",
      description: r.get("description") || "",
      emoji: r.get("emoji") || "",
      created_at: Number(r.get("created_at") || 0),
      owner_id: "",
      visibility: "private" as Visibility,
    }));
    this.collectionRows = new Map(
      crows.map((r: any) => [r.get("id") || "", r as GRow]),
    );
    const mrows = await ms.getRows();
    this.memberCache = mrows.map((r: any) => ({
      word_id: r.get("word_id") || "",
      collection_id: r.get("collection_id") || "",
    }));
    this.memberRows = mrows as unknown as GRow[];
  }
  async collections(userId: string): Promise<Collection[]> {
    await this.ensureCollections();
    const counts = new Map<string, number>();
    for (const m of this.memberCache!)
      counts.set(m.collection_id, (counts.get(m.collection_id) ?? 0) + 1);
    return [...this.collectionCache!]
      .sort((a, b) => b.created_at - a.created_at)
      .map((c) => ({
        ...c,
        owner_id: userId,
        count: counts.get(c.id) ?? 0,
        mine: true,
      }));
  }
  async createCollection(
    userId: string,
    input: { name: string; description?: string; emoji?: string },
  ): Promise<Collection> {
    await this.ensureCollections();
    const c: Collection = {
      id: randomUUID(),
      name: input.name.trim(),
      description: input.description ?? "",
      emoji: input.emoji ?? "",
      created_at: Date.now(),
      owner_id: userId,
      visibility: "private",
    };
    const row = await this.collectionsSheet.addRow({
      id: c.id,
      name: c.name,
      description: c.description,
      emoji: c.emoji,
      created_at: String(c.created_at),
    });
    this.collectionCache!.push(c);
    this.collectionRows!.set(c.id, row as unknown as GRow);
    return { ...c, count: 0, mine: true };
  }
  async updateCollection(
    userId: string,
    id: string,
    patch: Partial<Pick<Collection, "name" | "description" | "emoji">>,
  ): Promise<Collection | undefined> {
    await this.ensureCollections();
    const i = this.collectionCache!.findIndex((c) => c.id === id);
    if (i === -1) return undefined;
    const next = {
      ...this.collectionCache![i],
      ...patch,
      name: (patch.name ?? this.collectionCache![i].name).trim(),
    };
    this.collectionCache![i] = next;
    const row = this.collectionRows!.get(id);
    if (row) {
      row.set("name", next.name);
      row.set("description", next.description);
      row.set("emoji", next.emoji);
      await row.save();
    }
    return { ...next, owner_id: userId, mine: true };
  }
  async setCollectionVisibility(
    userId: string,
    id: string,
    visibility: Visibility,
  ): Promise<Collection | undefined> {
    // Public collections are a multi-tenant concept; the single-user Sheet keeps
    // the flag in-memory only (there is no other user to share with).
    await this.ensureCollections();
    const i = this.collectionCache!.findIndex((c) => c.id === id);
    if (i === -1) return undefined;
    this.collectionCache![i] = { ...this.collectionCache![i], visibility };
    return { ...this.collectionCache![i], owner_id: userId, mine: true };
  }
  async removeCollection(_userId: string, id: string): Promise<void> {
    await this.ensureCollections();
    const i = this.collectionCache!.findIndex((c) => c.id === id);
    if (i !== -1) this.collectionCache!.splice(i, 1);
    const row = this.collectionRows!.get(id);
    if (row) {
      await row.delete();
      this.collectionRows!.delete(id);
    }
    await this.removeMemberRows((m) => m.collection_id === id);
  }
  async adoptCollection(userId: string, id: string): Promise<number> {
    // Single user already "studies" every word — nothing to adopt.
    return (await this.wordIdsInCollection(userId, id)).length;
  }
  async wordIdsInCollection(_userId: string, collectionId: string): Promise<string[]> {
    await this.ensureCollections();
    return this.memberCache!
      .filter((m) => m.collection_id === collectionId)
      .map((m) => m.word_id);
  }
  async memberships(
    _userId: string,
  ): Promise<Array<{ word_id: string; collection_id: string }>> {
    await this.ensureCollections();
    return this.memberCache!.map((m) => ({ ...m }));
  }
  async setCollectionMembers(
    _userId: string,
    collectionId: string,
    change: { add?: string[]; remove?: string[] },
  ): Promise<void> {
    await this.ensureCollections();
    const present = new Set(
      this.memberCache!
        .filter((m) => m.collection_id === collectionId)
        .map((m) => m.word_id),
    );
    for (const wid of change.add ?? []) {
      if (present.has(wid)) continue;
      const row = await this.membersSheet.addRow({
        word_id: wid,
        collection_id: collectionId,
      });
      this.memberCache!.push({ word_id: wid, collection_id: collectionId });
      this.memberRows!.push(row as unknown as GRow);
      present.add(wid);
    }
    const removeSet = new Set(change.remove ?? []);
    if (removeSet.size)
      await this.removeMemberRows(
        (m) => m.collection_id === collectionId && removeSet.has(m.word_id),
      );
  }
  async setWordCollections(
    _userId: string,
    wordId: string,
    collectionIds: string[],
  ): Promise<void> {
    await this.ensureCollections();
    await this.removeMemberRows((m) => m.word_id === wordId);
    for (const cid of collectionIds) {
      const row = await this.membersSheet.addRow({
        word_id: wordId,
        collection_id: cid,
      });
      this.memberCache!.push({ word_id: wordId, collection_id: cid });
      this.memberRows!.push(row as unknown as GRow);
    }
  }
  /** Delete member rows matching a predicate, keeping cache and row list aligned. */
  private async removeMemberRows(
    pred: (m: { word_id: string; collection_id: string }) => boolean,
  ): Promise<void> {
    for (let i = this.memberCache!.length - 1; i >= 0; i--) {
      if (!pred(this.memberCache![i])) continue;
      const row = this.memberRows![i];
      if (row) await row.delete();
      this.memberCache!.splice(i, 1);
      this.memberRows!.splice(i, 1);
    }
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
