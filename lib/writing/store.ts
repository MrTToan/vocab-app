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
} from "./types";

/*
 * Writing storage — its own small libSQL layer over the SAME database file the
 * vocab store uses (.data/lexi.db by default, or DATABASE_URL/Turso). Kept
 * separate from lib/store.ts so the writing module is self-contained and the
 * vocab Store interface (and the optional Sheet backend) stay untouched.
 *
 * Tables (all additive): writing_prompts, writing_submissions, writing_corrections.
 */

type NewPrompt = Omit<WritingPrompt, "id" | "created_at" | "tags"> &
  Partial<Pick<WritingPrompt, "id" | "created_at" | "tags">>;

type NewSubmission = Omit<WritingSubmission, "id" | "created_at"> &
  Partial<Pick<WritingSubmission, "id" | "created_at">>;

let db: any = null;
let ready: Promise<void> | null = null;

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
          tags TEXT, last_shown INTEGER DEFAULT 0, created_at INTEGER
        )`,
      );
      await db.execute(
        `CREATE TABLE IF NOT EXISTS writing_submissions (
          id TEXT PRIMARY KEY, prompt_id TEXT, task_type TEXT, text TEXT,
          word_count INTEGER, overall_band REAL, bands TEXT, strengths TEXT,
          general_feedback TEXT, priorities TEXT, created_at INTEGER
        )`,
      );
      // migration: add priorities to DBs created before this column existed
      try {
        await db.execute("ALTER TABLE writing_submissions ADD COLUMN priorities TEXT");
      } catch {
        /* column already exists */
      }
      await db.execute(
        `CREATE TABLE IF NOT EXISTS writing_corrections (
          id TEXT PRIMARY KEY, submission_id TEXT, original TEXT, suggestion TEXT,
          error_type TEXT, criterion TEXT, explanation TEXT, start INTEGER, "end" INTEGER
        )`,
      );
      await db.execute(
        `CREATE INDEX IF NOT EXISTS idx_wp_task ON writing_prompts (task_type)`,
      );
      await db.execute(
        `CREATE INDEX IF NOT EXISTS idx_wc_sub ON writing_corrections (submission_id)`,
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

function rowToPrompt(r: any): WritingPrompt {
  return {
    id: String(r.id),
    task_type: String(r.task_type) as WritingTask,
    title: String(r.title ?? ""),
    prompt_text: String(r.prompt_text ?? ""),
    image_path: r.image_path ? String(r.image_path) : null,
    chart_data: r.chart_data ? jsonParse(r.chart_data, null) : null,
    model_answer: r.model_answer ? String(r.model_answer) : null,
    source_file: r.source_file ? String(r.source_file) : null,
    tags: jsonParse<string[]>(r.tags, []),
    created_at: Number(r.created_at ?? 0),
  };
}

export const writingStore = {
  async addPrompts(prompts: NewPrompt[]): Promise<WritingPrompt[]> {
    const c = await connect();
    const now = Date.now();
    const full: WritingPrompt[] = prompts.map((p) => ({
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
    }));
    if (!full.length) return [];
    await c.batch(
      full.map((p) => ({
        sql: `INSERT OR REPLACE INTO writing_prompts
          (id, task_type, title, prompt_text, image_path, chart_data, model_answer, source_file, tags, last_shown, created_at)
          VALUES (?,?,?,?,?,?,?,?,?,COALESCE((SELECT last_shown FROM writing_prompts WHERE id=?),0),?)`,
        args: [
          p.id, p.task_type, p.title, p.prompt_text, p.image_path,
          p.chart_data ? JSON.stringify(p.chart_data) : null,
          p.model_answer, p.source_file, JSON.stringify(p.tags), p.id, p.created_at,
        ],
      })),
      "write",
    );
    return full;
  },

  async listPrompts(task?: WritingTask): Promise<WritingPrompt[]> {
    const c = await connect();
    const rs = task
      ? await c.execute({ sql: "SELECT * FROM writing_prompts WHERE task_type=? ORDER BY created_at DESC", args: [task] })
      : await c.execute("SELECT * FROM writing_prompts ORDER BY created_at DESC");
    return rs.rows.map(rowToPrompt);
  },

  async getPrompt(id: string): Promise<WritingPrompt | undefined> {
    const c = await connect();
    const rs = await c.execute({ sql: "SELECT * FROM writing_prompts WHERE id=? LIMIT 1", args: [id] });
    return rs.rows[0] ? rowToPrompt(rs.rows[0]) : undefined;
  },

  /** Least-recently-shown prompt for a task; marks it shown (rotates the set). */
  async pickPrompt(task: WritingTask): Promise<WritingPrompt | undefined> {
    const c = await connect();
    const rs = await c.execute({
      sql: "SELECT * FROM writing_prompts WHERE task_type=? ORDER BY last_shown ASC, RANDOM() LIMIT 1",
      args: [task],
    });
    if (!rs.rows[0]) return undefined;
    const p = rowToPrompt(rs.rows[0]);
    await c.execute({ sql: "UPDATE writing_prompts SET last_shown=? WHERE id=?", args: [Date.now(), p.id] });
    return p;
  },

  async promptCount(task?: WritingTask): Promise<number> {
    const c = await connect();
    const rs = task
      ? await c.execute({ sql: "SELECT COUNT(*) n FROM writing_prompts WHERE task_type=?", args: [task] })
      : await c.execute("SELECT COUNT(*) n FROM writing_prompts");
    return Number(rs.rows[0]?.n ?? 0);
  },

  async addSubmission(sub: NewSubmission): Promise<WritingSubmission> {
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
        (id, prompt_id, task_type, text, word_count, overall_band, bands, strengths, general_feedback, priorities, created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      args: [
        full.id, full.prompt_id, full.task_type, full.text, full.word_count,
        full.overall_band, JSON.stringify(full.bands), JSON.stringify(full.strengths),
        full.general_feedback, JSON.stringify(full.priorities), full.created_at,
      ],
    });
    if (full.corrections.length) {
      await c.batch(
        full.corrections.map((cor: WritingCorrection) => ({
          sql: `INSERT INTO writing_corrections
            (id, submission_id, original, suggestion, error_type, criterion, explanation, start, "end")
            VALUES (?,?,?,?,?,?,?,?,?)`,
          args: [
            cor.id ?? randomUUID(), full.id, cor.original, cor.suggestion,
            cor.error_type, cor.criterion, cor.explanation, cor.start, cor.end,
          ],
        })),
        "write",
      );
    }
    return full;
  },

  async submissions(task?: WritingTask): Promise<WritingSubmission[]> {
    const c = await connect();
    const rs = task
      ? await c.execute({ sql: "SELECT * FROM writing_submissions WHERE task_type=? ORDER BY created_at DESC", args: [task] })
      : await c.execute("SELECT * FROM writing_submissions ORDER BY created_at DESC");
    return rs.rows.map((r: any) => ({
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
      corrections: [],
      created_at: Number(r.created_at ?? 0),
    }));
  },

  /** All corrections (optionally for a task) — powers the error-type report. */
  async allCorrections(task?: WritingTask): Promise<WritingCorrection[]> {
    const c = await connect();
    const rs = task
      ? await c.execute({
          sql: `SELECT wc.* FROM writing_corrections wc
                JOIN writing_submissions ws ON ws.id = wc.submission_id
                WHERE ws.task_type = ?`,
          args: [task],
        })
      : await c.execute("SELECT * FROM writing_corrections");
    return rs.rows.map((r: any) => ({
      id: String(r.id),
      submission_id: String(r.submission_id),
      original: String(r.original ?? ""),
      suggestion: String(r.suggestion ?? ""),
      error_type: String(r.error_type ?? "other") as WritingCorrection["error_type"],
      criterion: String(r.criterion ?? "task_achievement") as WritingCorrection["criterion"],
      explanation: String(r.explanation ?? ""),
      start: r.start == null ? null : Number(r.start),
      end: r.end == null ? null : Number(r.end),
    }));
  },

  async submissionCount(): Promise<number> {
    const c = await connect();
    const rs = await c.execute("SELECT COUNT(*) n FROM writing_submissions");
    return Number(rs.rows[0]?.n ?? 0);
  },

  /** Per-prompt practice summary (attempts, best/last band, last date). */
  async promptStats(task?: WritingTask): Promise<Record<string, { attempts: number; bestBand: number; lastBand: number; lastAt: number }>> {
    const c = await connect();
    const rs = task
      ? await c.execute({ sql: "SELECT prompt_id, overall_band, created_at FROM writing_submissions WHERE task_type=?", args: [task] })
      : await c.execute("SELECT prompt_id, overall_band, created_at FROM writing_submissions");
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
  async latestSubmission(promptId: string): Promise<WritingSubmission | null> {
    const c = await connect();
    const rs = await c.execute({
      sql: "SELECT * FROM writing_submissions WHERE prompt_id=? ORDER BY created_at DESC LIMIT 1",
      args: [promptId],
    });
    const r: any = rs.rows[0];
    if (!r) return null;
    const cr = await c.execute({ sql: 'SELECT * FROM writing_corrections WHERE submission_id=?', args: [String(r.id)] });
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
};
