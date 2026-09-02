
/*
 * Per-user LLM quota. Public users share the owner's provider keys, so EVERY
 * route that reaches a model is metered (a signed-in user is required by each
 * route first). Two layers, both applied by `reserveQuota`:
 *
 *   1. A daily cap per task, counted in `llm_usage(user_id, day, task, count)`.
 *      The reservation is ONE atomic upsert (`... DO UPDATE ... WHERE count < cap`)
 *      so concurrent calls (e.g. /api/import enriching 5 rows in parallel) can't
 *      slip past the cap.
 *   2. A cheap in-memory burst throttle shared by all tasks: at most
 *      BURST_PER_MINUTE calls per user per rolling minute (module-level map, so
 *      it's per server process — a floor, not a ledger; the daily cap is the ledger).
 *
 * Caps are per-user-per-UTC-day and overridable via env:
 *   QUOTA_ENRICH (150), QUOTA_SCORE (300), QUOTA_SCORE_WRITING (40),
 *   QUOTA_EXTRACT_CHART (5), QUOTA_DISCUSS (30), QUOTA_GENERATE (300).
 * `generate` (practice/next) is capped loosely: a real session is well under
 * 100 generations because bank questions are served first, and on over-cap the
 * route falls back to its local/no-LLM paths instead of failing.
 * The owner (local-user) is exempt so your own use is never throttled.
 */

import type { Client } from "@libsql/client";
import { getDb } from "../db";
import { DEV_USER_ID } from "./user";

/** The quota-tracked LLM tasks, in display order. */
export const QUOTA_TASKS = [
  "enrich",
  "score",
  "score-writing",
  "extract-chart",
  "discuss-writing",
  "generate",
] as const;
export type QuotaTask = (typeof QUOTA_TASKS)[number];

const ENV_VAR: Record<QuotaTask, string> = {
  enrich: "QUOTA_ENRICH",
  score: "QUOTA_SCORE",
  "score-writing": "QUOTA_SCORE_WRITING",
  "extract-chart": "QUOTA_EXTRACT_CHART",
  "discuss-writing": "QUOTA_DISCUSS",
  generate: "QUOTA_GENERATE",
};

const DEFAULT_CAP: Record<QuotaTask, number> = {
  enrich: 150,
  score: 300,
  "score-writing": 40,
  "extract-chart": 5,
  "discuss-writing": 30,
  generate: 300,
};

export function capFor(task: QuotaTask): number {
  const env = Number(process.env[ENV_VAR[task]]);
  if (Number.isFinite(env) && env > 0) return env;
  return DEFAULT_CAP[task];
}

export class QuotaError extends Error {
  constructor(public task: QuotaTask, public cap: number) {
    super(
      `Daily limit reached for ${task} (${cap}/day). It resets at midnight UTC.`,
    );
    this.name = "QuotaError";
  }
}

/** Thrown by the burst throttle. Routes map it to 429 like QuotaError. */
export class BurstError extends Error {
  constructor() {
    super("You're going a little fast — please slow down and try again in a minute.");
    this.name = "BurstError";
  }
}

/** Max LLM calls per user per rolling minute, across all tasks (per process). */
export const BURST_PER_MINUTE = 12;
const BURST_WINDOW_MS = 60_000;

// user_id -> timestamps (ms) of recent LLM calls inside the window.
const burst = new Map<string, number[]>();

/**
 * Sliding-window burst check. Returns true and records the call if the user is
 * under BURST_PER_MINUTE calls in the last minute; false otherwise. Exported so
 * tests can drive it directly; `reserveQuota` is the normal entry point.
 */
export function takeBurstToken(userId: string, now: number = Date.now()): boolean {
  const cutoff = now - BURST_WINDOW_MS;
  const recent = (burst.get(userId) ?? []).filter((t) => t > cutoff);
  if (recent.length >= BURST_PER_MINUTE) {
    burst.set(userId, recent);
    return false;
  }
  recent.push(now);
  burst.set(userId, recent);
  // Keep the map from growing with one-off visitors.
  if (burst.size > 10_000) {
    for (const [k, v] of burst) if (!v.some((t) => t > cutoff)) burst.delete(k);
  }
  return true;
}

/** Test hook: forget all burst state. */
export function resetBurst(): void {
  burst.clear();
}

async function connect(): Promise<Client> {
  // Shared process-wide client; the `llm_usage` table is created by migrate()
  // in lib/db.ts before this resolves.
  return getDb();
}

function utcDay(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

/**
 * Reserve one unit of quota for (userId, task). Throws BurstError if the user is
 * bursting, QuotaError if they are already at today's cap. The owner is exempt.
 * Call this immediately before an LLM call; on either error the route should
 * return 429 with the error's message. Pass `{ burst: false }` to skip the
 * per-minute window (used only for `generate`).
 */
export async function reserveQuota(
  userId: string,
  task: QuotaTask,
  opts: { burst?: boolean } = {},
): Promise<void> {
  if (userId === DEV_USER_ID) return; // owner is never throttled
  // `generate` is exempt from the burst window: it's fired for every practice
  // item that misses the bank, so it would starve the learner's own scoring calls.
  if (opts.burst !== false && !takeBurstToken(userId)) throw new BurstError();
  const cap = capFor(task);
  const c = await connect();
  const day = utcDay();
  // Single atomic statement: the insert (first call today) always succeeds when
  // cap >= 1; the conflict branch only increments while under the cap, so a
  // rejected reservation shows up as zero affected rows.
  const rs = await c.execute({
    sql: `INSERT INTO llm_usage (user_id, day, task, count) VALUES (?,?,?,1)
          ON CONFLICT(user_id, day, task) DO UPDATE SET count = count + 1
          WHERE llm_usage.count < ?`,
    args: [userId, day, task, cap],
  });
  if (Number(rs.rowsAffected) === 0) throw new QuotaError(task, cap);
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
  for (const r of rs.rows) used[String(r.task)] = Number(r.count);
  return Object.fromEntries(
    QUOTA_TASKS.map((t) => [t, { used: used[t] ?? 0, cap: capFor(t) }]),
  ) as Record<QuotaTask, { used: number; cap: number }>;
}

/** True for the two 429-shaped errors thrown by `reserveQuota`. */
export function isRateLimitError(err: unknown): err is QuotaError | BurstError {
  return err instanceof QuotaError || err instanceof BurstError;
}
