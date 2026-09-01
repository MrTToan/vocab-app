import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import {
  CRITERIA,
  type WritingPrompt,
  type WritingSubmission,
  type WritingCorrection,
  type WritingPriority,
  type WritingTask,
  type Criterion,
  type CriterionScore,
  type WritingDiscussionMessage,
  type WritingPromptSummary,
  type PromptVisibility,
} from "./types";
import { SYSTEM_OWNER, canEdit, isOwner, ownerIdFor } from "../auth/user";

/*
 * Writing storage — its own small libSQL layer over the SAME database file the
 * vocab store uses (.data/lexi.db by default, or DATABASE_URL/Turso). Kept
 * separate from lib/store.ts so the writing module is self-contained.
 *
 * MULTI-TENANCY:
 *  - writing_prompts carry `owner_id` + `visibility`, exactly like collections.
 *    `owner_id = __system__` + `public` is the site-curated bank everyone
 *    practises from (the site owner's ingest and anything the site owner
 *    publishes). Anyone else's self-serve prompt is `private` — visible,
 *    scorable and deletable only by its author until the site owner publishes
 *    it. Every prompt read is filtered to `public OR owner_id = caller`, so a
 *    user can never read/score against another user's private prompt by id.
 *    (`user_id` is the legacy "who ingested it" column; kept, not consulted.)
 *  - writing_submissions + writing_corrections are PER-USER — each student's
 *    essays, bands and stats are private (scoped by user_id).
 * Call sites use writingStore.forUser(userId); every method scopes to it.
 *
 * Tables (all additive): writing_prompts, writing_submissions, writing_corrections.
 */

type NewPrompt = Omit<WritingPrompt, "id" | "created_at" | "tags" | "owner_id" | "visibility"> &
  Partial<Pick<WritingPrompt, "id" | "created_at" | "tags" | "owner_id" | "visibility">>;

type NewSubmission = Omit<WritingSubmission, "id" | "created_at"> &
  Partial<Pick<WritingSubmission, "id" | "created_at">>;

let db: any = null;
let ready: Promise<void> | null = null;

async function addColumn(d: any, table: string, colDef: string): Promise<void> {
  try {
    await d.execute(`ALTER TABLE ${table} ADD COLUMN ${colDef}`);
  } catch {
    /* column already exists */
  }
}

async function connect(): Promise<any> {
  if (!ready) {
    ready = (async () => {
      const { createClient } = await import("@libsql/client");
      let url = process.env.DATABASE_URL;
      if (!url) {
        const dir = path.join(process.cwd(), ".data");
        await fs.mkdir(dir, { recursive: true });
        url = `file:${path.join(dir, "lexi.db")}`;
      } else if (url.startsWith("file:")) {
        await fs.mkdir(path.dirname(path.resolve(url.slice(5))), { recursive: true });
      }
      db = createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN });
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
      await db.execute(
        `CREATE INDEX IF NOT EXISTS idx_wp_task ON writing_prompts (task_type)`,
      );
      await db.execute(
        `CREATE INDEX IF NOT EXISTS idx_ws_user ON writing_submissions (user_id, prompt_id)`,
      );
      await db.execute(
        `CREATE INDEX IF NOT EXISTS idx_wc_sub ON writing_corrections (submission_id)`,
      );
      await db.execute(
        `CREATE INDEX IF NOT EXISTS idx_wd_sub ON writing_discussions (submission_id, card_key, seq)`,
      );
    })();
  }
  await ready;
  return db;
}

function jsonParse<T>(s: unknown, fallback: T): T {
  if (typeof s !== "string" || !s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

/** Thrown when a caller tries to delete/publish a prompt they may not manage. */
export class PromptForbiddenError extends Error {
  constructor(message = "forbidden") {
    super(message);
    this.name = "PromptForbiddenError";
  }
}

type Row = Record<string, unknown>;

function rowToSummary(r: Row): WritingPromptSummary {
  return {
    id: String(r.id),
    task_type: String(r.task_type) as WritingTask,
    title: String(r.title ?? ""),
    prompt_text: String(r.prompt_text ?? ""),
    chart_data: r.chart_data ? jsonParse(r.chart_data, null) : null,
    model_answer: r.model_answer ? String(r.model_answer) : null,
    source_file: r.source_file ? String(r.source_file) : null,
    tags: jsonParse<string[]>(r.tags, []),
    created_at: Number(r.created_at ?? 0),
    owner_id: String(r.owner_id || SYSTEM_OWNER),
    visibility: r.visibility === "public" ? "public" : "private",
    has_image: !!r.has_image,
  };
}

function rowToPrompt(r: Row): WritingPrompt {
  const summary: Partial<WritingPromptSummary> = rowToSummary(r);
  delete summary.has_image;
  return { ...(summary as Omit<WritingPromptSummary, "has_image">), image_path: r.image_path ? String(r.image_path) : null };
}

/** Columns of a prompt row EXCEPT the (potentially multi-MB) image. */
const SUMMARY_COLS = `id, task_type, title, prompt_text, chart_data, model_answer, source_file,
  tags, created_at, owner_id, visibility,
  (image_path IS NOT NULL AND image_path != '') AS has_image`;

/** WHERE fragment: prompts the caller may see — public, or their own. Bind
 *  `visibleArgs(userId)`: the site owner's "own" content is the `__system__`
 *  bank (ownerIdFor), so unpublished bank prompts stay visible to them. */
const VISIBLE = "(visibility = 'public' OR owner_id = ? OR owner_id = ?)";
const visibleArgs = (userId: string) => [userId, ownerIdFor(userId)];

/** May `userId` delete/manage the prompt owned by `ownerId`? The author, the
 *  site owner for the shared bank, and the site owner for anything (moderation). */
function canManage(userId: string, ownerId: string): boolean {
  return canEdit(userId, ownerId) || isOwner(userId);
}

const emptyBands = () =>
  Object.fromEntries(CRITERIA.map((k) => [k, { band: 0, comment: "" }])) as Record<
    Criterion,
    CriterionScore
  >;

function rowToCorrection(r: any): WritingCorrection {
  return {
    id: String(r.id),
    submission_id: String(r.submission_id),
    original: String(r.original ?? ""),
    suggestion: String(r.suggestion ?? ""),
    error_type: String(r.error_type ?? "other") as WritingCorrection["error_type"],
    criterion: String(r.criterion ?? "task_achievement") as WritingCorrection["criterion"],
    explanation: String(r.explanation ?? ""),
    start: r.start == null ? null : Number(r.start),
    end: r.end == null ? null : Number(r.end),
  };
}

function rowToSubmission(r: any, corrections: WritingCorrection[]): WritingSubmission {
  return {
    id: String(r.id),
    prompt_id: String(r.prompt_id),
    task_type: String(r.task_type) as WritingTask,
    text: String(r.text ?? ""),
    word_count: Number(r.word_count ?? 0),
    overall_band: Number(r.overall_band ?? 0),
    bands: jsonParse<Record<Criterion, CriterionScore>>(r.bands, emptyBands()),
    strengths: jsonParse<string[]>(r.strengths, []),
    general_feedback: String(r.general_feedback ?? ""),
    priorities: jsonParse<WritingPriority[]>(r.priorities, []),
    corrections,
    created_at: Number(r.created_at ?? 0),
  };
}

/* ─────────────────  raw (userId-first) implementation  ────────────────── */

const raw = {
  /**
   * Insert prompts authored by `userId`. Ownership defaults per `ownerIdFor`:
   * the site owner writes to the shared bank (`__system__`, public); anyone
   * else gets a private prompt of their own. Re-using an existing id (idempotent
   * ingest) is allowed only for a prompt the caller may manage.
   */
  async addPrompts(userId: string, prompts: NewPrompt[]): Promise<WritingPrompt[]> {
    const c = await connect();
    const now = Date.now();
    const defaultOwner = ownerIdFor(userId);
    const full: WritingPrompt[] = prompts.map((p) => {
      const owner_id = p.owner_id ?? defaultOwner;
      return {
        id: p.id ?? randomUUID(),
        task_type: p.task_type,
        title: p.title,
        prompt_text: p.prompt_text,
        image_path: p.image_path ?? null,
        chart_data: p.chart_data ?? null,
        model_answer: p.model_answer ?? null,
        source_file: p.source_file ?? null,
        tags: p.tags ?? [],
        created_at: p.created_at ?? now,
        owner_id,
        visibility: p.visibility ?? (owner_id === SYSTEM_OWNER ? "public" : "private"),
      };
    });
    if (!full.length) return [];
    // A caller may only overwrite ids they own (INSERT OR REPLACE below).
    const existing = await c.execute({
      sql: `SELECT id, owner_id FROM writing_prompts WHERE id IN (${full.map(() => "?").join(",")})`,
      args: full.map((p) => p.id),
    });
    for (const r of existing.rows as Row[]) {
      if (!canManage(userId, String(r.owner_id || SYSTEM_OWNER)))
        throw new PromptForbiddenError("cannot overwrite this prompt");
    }
    await c.batch(
      full.map((p) => ({
        sql: `INSERT OR REPLACE INTO writing_prompts
          (id, task_type, title, prompt_text, image_path, chart_data, model_answer, source_file, tags, last_shown, created_at, user_id, owner_id, visibility)
          VALUES (?,?,?,?,?,?,?,?,?,COALESCE((SELECT last_shown FROM writing_prompts WHERE id=?),0),?,?,?,?)`,
        args: [
          p.id, p.task_type, p.title, p.prompt_text, p.image_path,
          p.chart_data ? JSON.stringify(p.chart_data) : null,
          p.model_answer, p.source_file, JSON.stringify(p.tags), p.id, p.created_at, userId,
          p.owner_id, p.visibility,
        ],
      })),
      "write",
    );
    return full;
  },

  // ── prompts the caller may see: public OR their own ──
  /** List WITHOUT image bytes (see `WritingPromptSummary`). */
  async listPrompts(userId: string, task?: WritingTask): Promise<WritingPromptSummary[]> {
    const c = await connect();
    const rs = task
      ? await c.execute({
          sql: `SELECT ${SUMMARY_COLS} FROM writing_prompts WHERE task_type=? AND ${VISIBLE} ORDER BY created_at DESC`,
          args: [task, ...visibleArgs(userId)],
        })
      : await c.execute({
          sql: `SELECT ${SUMMARY_COLS} FROM writing_prompts WHERE ${VISIBLE} ORDER BY created_at DESC`,
          args: visibleArgs(userId),
        });
    return rs.rows.map(rowToSummary);
  },

  async getPrompt(userId: string, id: string): Promise<WritingPrompt | undefined> {
    const c = await connect();
    const rs = await c.execute({
      sql: `SELECT * FROM writing_prompts WHERE id=? AND ${VISIBLE} LIMIT 1`,
      args: [id, ...visibleArgs(userId)],
    });
    return rs.rows[0] ? rowToPrompt(rs.rows[0]) : undefined;
  },

  /** Just the stored image (data URL or /public path) of a visible prompt, or undefined. */
  async getPromptImage(userId: string, id: string): Promise<string | undefined> {
    const c = await connect();
    const rs = await c.execute({
      sql: `SELECT image_path FROM writing_prompts WHERE id=? AND ${VISIBLE} LIMIT 1`,
      args: [id, ...visibleArgs(userId)],
    });
    const v = (rs.rows[0] as Row | undefined)?.image_path;
    return v ? String(v) : undefined;
  },

  /**
   * Delete a prompt (its submissions/corrections are left intact). Only the
   * author / the site owner may; anyone else gets PromptForbiddenError. Returns
   * false if no such visible prompt exists.
   */
  async deletePrompt(userId: string, id: string): Promise<boolean> {
    const c = await connect();
    const rs = await c.execute({
      sql: `SELECT owner_id FROM writing_prompts WHERE id=? AND ${VISIBLE} LIMIT 1`,
      args: [id, ...visibleArgs(userId)],
    });
    const cur = rs.rows[0] as Row | undefined;
    if (!cur) return false;
    if (!canManage(userId, String(cur.owner_id || SYSTEM_OWNER)))
      throw new PromptForbiddenError("cannot delete this prompt");
    await c.execute({ sql: "DELETE FROM writing_prompts WHERE id=?", args: [id] });
    return true;
  },

  /**
   * Publish / unpublish. Site-owner-only: only the site owner curates the shared
   * bank. The site owner may flip ANY prompt by id (that is how a learner's
   * private prompt gets promoted); everyone else gets PromptForbiddenError for a
   * prompt they can see and undefined (not found) for one they can't.
   */
  async setPromptVisibility(
    userId: string,
    id: string,
    visibility: PromptVisibility,
  ): Promise<WritingPromptSummary | undefined> {
    const c = await connect();
    const rs = isOwner(userId)
      ? await c.execute({ sql: `SELECT ${SUMMARY_COLS} FROM writing_prompts WHERE id=? LIMIT 1`, args: [id] })
      : await c.execute({
          sql: `SELECT ${SUMMARY_COLS} FROM writing_prompts WHERE id=? AND ${VISIBLE} LIMIT 1`,
          args: [id, ...visibleArgs(userId)],
        });
    const cur = rs.rows[0] as Row | undefined;
    if (!cur) return undefined;
    if (!isOwner(userId)) throw new PromptForbiddenError("only the site owner can publish prompts");
    await c.execute({ sql: "UPDATE writing_prompts SET visibility=? WHERE id=?", args: [visibility, id] });
    return rowToSummary({ ...cur, visibility });
  },

  /** Least-recently-shown visible prompt for a task; marks it shown. */
  async pickPrompt(userId: string, task: WritingTask): Promise<WritingPrompt | undefined> {
    const c = await connect();
    const rs = await c.execute({
      sql: `SELECT * FROM writing_prompts WHERE task_type=? AND ${VISIBLE} ORDER BY last_shown ASC, RANDOM() LIMIT 1`,
      args: [task, ...visibleArgs(userId)],
    });
    if (!rs.rows[0]) return undefined;
    const p = rowToPrompt(rs.rows[0]);
    await c.execute({ sql: "UPDATE writing_prompts SET last_shown=? WHERE id=?", args: [Date.now(), p.id] });
    return p;
  },

  async promptCount(userId: string, task?: WritingTask): Promise<number> {
    const c = await connect();
    const rs = task
      ? await c.execute({ sql: `SELECT COUNT(*) n FROM writing_prompts WHERE task_type=? AND ${VISIBLE}`, args: [task, ...visibleArgs(userId)] })
      : await c.execute({ sql: `SELECT COUNT(*) n FROM writing_prompts WHERE ${VISIBLE}`, args: visibleArgs(userId) });
    return Number(rs.rows[0]?.n ?? 0);
  },

  async addSubmission(userId: string, sub: NewSubmission): Promise<WritingSubmission> {
    const c = await connect();
    const full: WritingSubmission = {
      id: sub.id ?? randomUUID(),
      prompt_id: sub.prompt_id,
      task_type: sub.task_type,
      text: sub.text,
      word_count: sub.word_count,
      overall_band: sub.overall_band,
      bands: sub.bands,
      strengths: sub.strengths,
      general_feedback: sub.general_feedback,
      priorities: sub.priorities,
      corrections: sub.corrections,
      created_at: sub.created_at ?? Date.now(),
    };
    await c.execute({
      sql: `INSERT INTO writing_submissions
        (id, prompt_id, task_type, text, word_count, overall_band, bands, strengths, general_feedback, priorities, created_at, user_id)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      args: [
        full.id, full.prompt_id, full.task_type, full.text, full.word_count,
        full.overall_band, JSON.stringify(full.bands), JSON.stringify(full.strengths),
        full.general_feedback, JSON.stringify(full.priorities), full.created_at, userId,
      ],
    });
    if (full.corrections.length) {
      await c.batch(
        full.corrections.map((cor: WritingCorrection) => ({
          sql: `INSERT INTO writing_corrections
            (id, submission_id, original, suggestion, error_type, criterion, explanation, start, "end", user_id)
            VALUES (?,?,?,?,?,?,?,?,?,?)`,
          args: [
            cor.id ?? randomUUID(), full.id, cor.original, cor.suggestion,
            cor.error_type, cor.criterion, cor.explanation, cor.start, cor.end, userId,
          ],
        })),
        "write",
      );
    }
    return full;
  },

  async submissions(userId: string, task?: WritingTask): Promise<WritingSubmission[]> {
    const c = await connect();
    const rs = task
      ? await c.execute({ sql: "SELECT * FROM writing_submissions WHERE user_id=? AND task_type=? ORDER BY created_at DESC", args: [userId, task] })
      : await c.execute({ sql: "SELECT * FROM writing_submissions WHERE user_id=? ORDER BY created_at DESC", args: [userId] });
    return rs.rows.map((r: any) => rowToSubmission(r, []));
  },

  /** All corrections (optionally for a task) — powers the error-type report. */
  async allCorrections(userId: string, task?: WritingTask): Promise<WritingCorrection[]> {
    const c = await connect();
    const rs = task
      ? await c.execute({
          sql: `SELECT wc.* FROM writing_corrections wc
                JOIN writing_submissions ws ON ws.id = wc.submission_id
                WHERE wc.user_id = ? AND ws.task_type = ?`,
          args: [userId, task],
        })
      : await c.execute({ sql: "SELECT * FROM writing_corrections WHERE user_id=?", args: [userId] });
    return rs.rows.map(rowToCorrection);
  },

  async submissionCount(userId: string): Promise<number> {
    const c = await connect();
    const rs = await c.execute({ sql: "SELECT COUNT(*) n FROM writing_submissions WHERE user_id=?", args: [userId] });
    return Number(rs.rows[0]?.n ?? 0);
  },

  /** Per-prompt practice summary (attempts, best/last band, last date). */
  async promptStats(
    userId: string,
    task?: WritingTask,
  ): Promise<Record<string, { attempts: number; bestBand: number; lastBand: number; lastAt: number }>> {
    const c = await connect();
    const rs = task
      ? await c.execute({ sql: "SELECT prompt_id, overall_band, created_at FROM writing_submissions WHERE user_id=? AND task_type=?", args: [userId, task] })
      : await c.execute({ sql: "SELECT prompt_id, overall_band, created_at FROM writing_submissions WHERE user_id=?", args: [userId] });
    const out: Record<string, { attempts: number; bestBand: number; lastBand: number; lastAt: number }> = {};
    for (const r of rs.rows as any[]) {
      const pid = String(r.prompt_id);
      const band = Number(r.overall_band ?? 0);
      const at = Number(r.created_at ?? 0);
      const g = out[pid] ?? { attempts: 0, bestBand: 0, lastBand: 0, lastAt: 0 };
      g.attempts++;
      g.bestBand = Math.max(g.bestBand, band);
      if (at >= g.lastAt) { g.lastAt = at; g.lastBand = band; }
      out[pid] = g;
    }
    return out;
  },

  /** The most recent full submission (with corrections) for a prompt, or null. */
  async latestSubmission(userId: string, promptId: string): Promise<WritingSubmission | null> {
    const c = await connect();
    const rs = await c.execute({
      sql: "SELECT * FROM writing_submissions WHERE user_id=? AND prompt_id=? ORDER BY created_at DESC LIMIT 1",
      args: [userId, promptId],
    });
    const r: any = rs.rows[0];
    if (!r) return null;
    const cr = await c.execute({ sql: 'SELECT * FROM writing_corrections WHERE submission_id=? AND user_id=?', args: [String(r.id), userId] });
    return rowToSubmission(r, (cr.rows as any[]).map(rowToCorrection));
  },
};

/** A user-scoped view of the writing store. */
export interface WritingScope {
  addPrompts(prompts: NewPrompt[]): Promise<WritingPrompt[]>;
  listPrompts(task?: WritingTask): Promise<WritingPromptSummary[]>;
  getPrompt(id: string): Promise<WritingPrompt | undefined>;
  getPromptImage(id: string): Promise<string | undefined>;
  deletePrompt(id: string): Promise<boolean>;
  setPromptVisibility(id: string, visibility: PromptVisibility): Promise<WritingPromptSummary | undefined>;
  pickPrompt(task: WritingTask): Promise<WritingPrompt | undefined>;
  promptCount(task?: WritingTask): Promise<number>;
  addSubmission(sub: NewSubmission): Promise<WritingSubmission>;
  submissions(task?: WritingTask): Promise<WritingSubmission[]>;
  allCorrections(task?: WritingTask): Promise<WritingCorrection[]>;
  submissionCount(): Promise<number>;
  promptStats(task?: WritingTask): Promise<Record<string, { attempts: number; bestBand: number; lastBand: number; lastAt: number }>>;
  latestSubmission(promptId: string): Promise<WritingSubmission | null>;
}

export const writingStore = {
  /** Return a view of the writing store scoped to a single user. */
  forUser(userId: string): WritingScope {
    return {
      // prompts: public bank + this user's own private ones
      addPrompts: (prompts) => raw.addPrompts(userId, prompts),
      listPrompts: (task) => raw.listPrompts(userId, task),
      getPrompt: (id) => raw.getPrompt(userId, id),
      getPromptImage: (id) => raw.getPromptImage(userId, id),
      deletePrompt: (id) => raw.deletePrompt(userId, id),
      setPromptVisibility: (id, v) => raw.setPromptVisibility(userId, id, v),
      pickPrompt: (task) => raw.pickPrompt(userId, task),
      promptCount: (task) => raw.promptCount(userId, task),
      // per-user submissions / scores / stats
      addSubmission: (sub) => raw.addSubmission(userId, sub),
      submissions: (task) => raw.submissions(userId, task),
      allCorrections: (task) => raw.allCorrections(userId, task),
      submissionCount: () => raw.submissionCount(userId),
      promptStats: (task) => raw.promptStats(userId, task),
      latestSubmission: (promptId) => raw.latestSubmission(userId, promptId),
    };
  },

  /**
   * One stored submission by id (with its corrections) — used by the discuss flow.
   * Scoped to the owner: a caller can only read their OWN submission (isolation).
   */
  async getSubmission(userId: string, id: string): Promise<WritingSubmission | null> {
    const c = await connect();
    const rs = await c.execute({ sql: "SELECT * FROM writing_submissions WHERE id=? AND user_id=?", args: [id, ...visibleArgs(userId)] });
    const r: any = rs.rows[0];
    if (!r) return null;
    const cr = await c.execute({ sql: "SELECT * FROM writing_corrections WHERE submission_id=?", args: [id] });
    return {
      id: String(r.id),
      prompt_id: String(r.prompt_id),
      task_type: String(r.task_type) as WritingTask,
      text: String(r.text ?? ""),
      word_count: Number(r.word_count ?? 0),
      overall_band: Number(r.overall_band ?? 0),
      bands: jsonParse<Record<Criterion, CriterionScore>>(
        r.bands,
        Object.fromEntries(CRITERIA.map((k) => [k, { band: 0, comment: "" }])) as Record<Criterion, CriterionScore>,
      ),
      strengths: jsonParse<string[]>(r.strengths, []),
      general_feedback: String(r.general_feedback ?? ""),
      priorities: jsonParse<WritingPriority[]>(r.priorities, []),
      corrections: (cr.rows as any[]).map((x) => ({
        id: String(x.id),
        submission_id: String(x.submission_id),
        original: String(x.original ?? ""),
        suggestion: String(x.suggestion ?? ""),
        error_type: String(x.error_type ?? "other") as WritingCorrection["error_type"],
        criterion: String(x.criterion ?? "task_achievement") as WritingCorrection["criterion"],
        explanation: String(x.explanation ?? ""),
        start: x.start == null ? null : Number(x.start),
        end: x.end == null ? null : Number(x.end),
      })),
      created_at: Number(r.created_at ?? 0),
    };
  },

  /** All discussion messages for a submission, ordered — grouped by card on the client. */
  async listDiscussion(submissionId: string): Promise<WritingDiscussionMessage[]> {
    const c = await connect();
    const rs = await c.execute({
      sql: "SELECT * FROM writing_discussions WHERE submission_id=? ORDER BY card_key, seq",
      args: [submissionId],
    });
    return (rs.rows as any[]).map((x) => ({
      id: String(x.id),
      submission_id: String(x.submission_id),
      card_key: String(x.card_key),
      role: String(x.role) === "assistant" ? "assistant" : "user",
      content: String(x.content ?? ""),
      seq: Number(x.seq ?? 0),
      created_at: Number(x.created_at ?? 0),
    }));
  },

  /** Append messages to one (submission, card) thread; returns the full updated thread. */
  async addDiscussionMessages(
    submissionId: string,
    cardKey: string,
    msgs: { role: "user" | "assistant"; content: string }[],
  ): Promise<WritingDiscussionMessage[]> {
    const c = await connect();
    const rs = await c.execute({
      sql: "SELECT COALESCE(MAX(seq), -1) m FROM writing_discussions WHERE submission_id=? AND card_key=?",
      args: [submissionId, cardKey],
    });
    let seq = Number((rs.rows[0] as any)?.m ?? -1);
    const now = Date.now();
    await c.batch(
      msgs.map((m) => {
        seq += 1;
        return {
          sql: `INSERT INTO writing_discussions (id, submission_id, card_key, role, content, seq, created_at)
                VALUES (?,?,?,?,?,?,?)`,
          args: [randomUUID(), submissionId, cardKey, m.role, m.content, seq, now],
        };
      }),
      "write",
    );
    const thread = await c.execute({
      sql: "SELECT * FROM writing_discussions WHERE submission_id=? AND card_key=? ORDER BY seq",
      args: [submissionId, cardKey],
    });
    return (thread.rows as any[]).map((x) => ({
      id: String(x.id),
      submission_id: String(x.submission_id),
      card_key: String(x.card_key),
      role: String(x.role) === "assistant" ? "assistant" : "user",
      content: String(x.content ?? ""),
      seq: Number(x.seq ?? 0),
      created_at: Number(x.created_at ?? 0),
    }));
  },
};
