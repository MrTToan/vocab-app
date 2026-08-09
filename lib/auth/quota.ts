import { promises as fs } from "fs";
import path from "path";

/*
 * Per-user daily LLM quota. Public users share the owner's provider keys, so a
 * daily cap on the expensive/abusable tasks (enrich + scoring) protects the bill.
 * Counts live in `llm_usage(user_id, day, task, count)`. Cheap in-loop generation
 * (practice/next) is intentionally NOT capped — capping it would break practice.
 *
 * Caps are per-user-per-UTC-day and overridable via env:
 *   QUOTA_ENRICH (default 150), QUOTA_SCORE (default 300), QUOTA_SCORE_WRITING (default 40).
 * The owner (local-user) is exempt so your own use is never throttled.
 */

import { DEV_USER_ID } from "./user";

export type QuotaTask = "enrich" | "score" | "score-writing";

function capFor(task: QuotaTask): number {
  const env = {
    enrich: Number(process.env.QUOTA_ENRICH),
    score: Number(process.env.QUOTA_SCORE),
    "score-writing": Number(process.env.QUOTA_SCORE_WRITING),
  }[task];
  if (Number.isFinite(env) && env > 0) return env;
  return { enrich: 150, score: 300, "score-writing": 40 }[task];
}

export class QuotaError extends Error {
  constructor(public task: QuotaTask, public cap: number) {
    super(
      `Daily limit reached for ${task} (${cap}/day). It resets at midnight UTC.`,
    );
    this.name = "QuotaError";
  }
}

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
        `CREATE TABLE IF NOT EXISTS llm_usage (
          user_id TEXT, day TEXT, task TEXT, count INTEGER DEFAULT 0,
          PRIMARY KEY (user_id, day, task)
        )`,
      );
    })();
  }
  await ready;
  return db;
}

function utcDay(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

/**
 * Reserve one unit of quota for (userId, task). Throws QuotaError if the user is
 * already at the cap for today. The owner is exempt. Call this immediately before
 * an LLM call; on QuotaError the route should return 429.
 */
export async function reserveQuota(userId: string, task: QuotaTask): Promise<void> {
  if (userId === DEV_USER_ID) return; // owner is never throttled
  const cap = capFor(task);
  const c = await connect();
  const day = utcDay();
  const rs = await c.execute({
    sql: "SELECT count FROM llm_usage WHERE user_id=? AND day=? AND task=?",
    args: [userId, day, task],
  });
  const used = rs.rows[0] ? Number(rs.rows[0].count) : 0;
  if (used >= cap) throw new QuotaError(task, cap);
  await c.execute({
    sql: `INSERT INTO llm_usage (user_id, day, task, count) VALUES (?,?,?,1)
          ON CONFLICT(user_id, day, task) DO UPDATE SET count = count + 1`,
    args: [userId, day, task],
  });
}

/** Current usage for a user today (for a "you've used X/Y" UI later). */
export async function quotaStatus(
  userId: string,
): Promise<Record<QuotaTask, { used: number; cap: number }>> {
  const c = await connect();
  const day = utcDay();
  const rs = await c.execute({
    sql: "SELECT task, count FROM llm_usage WHERE user_id=? AND day=?",
    args: [userId, day],
  });
  const used: Record<string, number> = {};
  for (const r of rs.rows as any[]) used[String(r.task)] = Number(r.count);
  const tasks: QuotaTask[] = ["enrich", "score", "score-writing"];
  return Object.fromEntries(
    tasks.map((t) => [t, { used: used[t] ?? 0, cap: capFor(t) }]),
  ) as Record<QuotaTask, { used: number; cap: number }>;
}
