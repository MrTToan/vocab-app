import { QUOTA_TASKS, type QuotaTask } from "../auth/quota";
import { STAGE_ORDER } from "../ui";
import type { Stage } from "../types";
import type { DayBar } from "../report";
import {
  fillDailySeries,
  cumulative,
  ymdUTC,
  lastNDaysUTC,
  shortDayLabel,
  type DayPoint,
} from "./aggregate";

/*
 * Owner-only admin metrics. Read-only aggregate queries over the SAME libSQL DB
 * the app uses, opened with a private client (mirroring lib/auth/quota.ts and
 * lib/auth/store.ts). Everything is aggregated IN SQL — we never pull whole
 * tables into JS — and only counts/identities are returned, never a user's raw
 * vocab/writing content (this is a metrics view, not a data browser).
 *
 * Gating is the caller's job: the /api/admin/stats route and /admin page reject
 * non-owners via isOwner() before this module is ever reached.
 */

const WINDOW_DAYS = 30;

import { getDb } from "../db";

async function connect() {
  return getDb(); // shared process-wide client (lib/db.ts)
}

/**
 * Run a query, returning `fallback` if the table doesn't exist yet. The app
 * creates its tables lazily on first use; a pristine DB (e.g. admin opened
 * before anyone has studied) shouldn't 500 the dashboard.
 */
async function q<T>(
  c: any,
  sql: string,
  map: (rows: any[]) => T,
  fallback: T,
  args: any[] = [],
): Promise<T> {
  try {
    const rs = await c.execute(args.length ? { sql, args } : sql);
    return map(rs.rows as any[]);
  } catch (e: any) {
    if (String(e?.message ?? e).includes("no such table")) return fallback;
    throw e;
  }
}

const num = (v: any): number => (v == null ? 0 : Number(v));
const s = (v: any): string => (v == null ? "" : String(v));

/** A display label for a user id, preferring name, then email, then a short id. */
function userLabel(name: any, email: any, id: string): string {
  return s(name) || s(email) || `${id.slice(0, 8)}…`;
}

export interface UserWordStat {
  user_id: string;
  label: string;
  studied: number;
  mastered: number;
}
export interface LlmUserStat {
  user_id: string;
  label: string;
  total: number;
}

export interface AdminStats {
  generated_at: number;
  window_days: number;
  users: {
    total: number;
    signups: DayPoint[]; // new signups per day (last WINDOW_DAYS)
    cumulative: DayPoint[]; // running total over the window
    newInWindow: number;
  };
  vocab: {
    catalogWords: number; // distinct content words in the shared catalog
    studiedInstances: number; // user_words rows (a user studying a word)
    distinctStudied: number; // distinct words studied by anyone
    stageCounts: Record<Stage, number>; // catalog-wide mastery funnel (all users)
    topUsers: UserWordStat[]; // most-active users by words studied
  };
  progress: {
    mastered: number; // stage = known, across all users
  };
  activity: {
    totalAttempts: number;
    attempts: DayPoint[]; // attempts per day (last WINDOW_DAYS)
    activeUsers: DayPoint[]; // distinct users with ≥1 attempt per day
    byDay: DayBar[]; // per-day result mix (correct/almost/missed) — stacked columns
    overall: { correct: number; partial: number; incorrect: number; total: number }; // window result mix
  };
  llm: {
    total: number; // all-time units across every task
    today: number; // units used today (UTC)
    windowTotal: number; // units in the last WINDOW_DAYS
    daily: DayPoint[]; // units per day (last WINDOW_DAYS) — the spend trend
    byTask: Record<QuotaTask, number>;
    topUsers: LlmUserStat[]; // heaviest consumers all-time
  };
}

/** Compute the full owner dashboard. Aggregates in SQL; shapes series in JS. */
export async function adminStats(now: number = Date.now()): Promise<AdminStats> {
  const c = await connect();

  // ── users ──────────────────────────────────────────────────────────────
  const usersTotal = await q(
    c,
    "SELECT COUNT(*) n FROM users",
    (r) => num(r[0]?.n),
    0,
  );
  const signupRows = await q(
    c,
    `SELECT date(created_at/1000, 'unixepoch') day, COUNT(*) count
       FROM users WHERE created_at IS NOT NULL GROUP BY day`,
    (r) => r.map((x) => ({ day: s(x.day), count: num(x.count) })),
    [] as { day: string; count: number }[],
  );
  const signups = fillDailySeries(signupRows, WINDOW_DAYS, now);

  // ── vocabulary ───────────────────────────────────────────────────────────
  const catalogWords = await q(
    c,
    "SELECT COUNT(*) n FROM words",
    (r) => num(r[0]?.n),
    0,
  );
  const studiedInstances = await q(
    c,
    "SELECT COUNT(*) n FROM user_words",
    (r) => num(r[0]?.n),
    0,
  );
  const distinctStudied = await q(
    c,
    "SELECT COUNT(DISTINCT word_id) n FROM user_words",
    (r) => num(r[0]?.n),
    0,
  );
  // Catalog-wide mastery funnel: every studied word across all users, bucketed
  // by stage. Zero-filled over the canonical New→Known order so the pipeline
  // renders even when a stage is empty.
  const stageRows = await q(
    c,
    "SELECT stage, COUNT(*) n FROM user_words GROUP BY stage",
    (r) => r.map((x) => ({ stage: s(x.stage), n: num(x.n) })),
    [] as { stage: string; n: number }[],
  );
  const stageCounts = Object.fromEntries(STAGE_ORDER.map((st) => [st, 0])) as Record<Stage, number>;
  for (const row of stageRows) {
    if ((STAGE_ORDER as readonly string[]).includes(row.stage))
      stageCounts[row.stage as Stage] = row.n;
  }
  // All users ranked by words studied (descending). Returned in full — the
  // dashboard paginates client-side (the user count is small). Still aggregated
  // in SQL; only counts + a display label leave the DB. Starts FROM users (not
  // user_words) so users who haven't studied anything still appear, with 0 —
  // COUNT(uw.word_id) counts matched rows only, so no-progress users get 0.
  const topUsers = await q(
    c,
    `SELECT u.id AS user_id,
            COUNT(uw.word_id) studied,
            SUM(CASE WHEN uw.stage = 'known' THEN 1 ELSE 0 END) mastered,
            u.name, u.email
       FROM users u
       LEFT JOIN user_words uw ON uw.user_id = u.id
      GROUP BY u.id
      ORDER BY studied DESC, u.name, u.created_at`,
    (r) =>
      r.map((x) => ({
        user_id: s(x.user_id),
        label: userLabel(x.name, x.email, s(x.user_id)),
        studied: num(x.studied),
        mastered: num(x.mastered),
      })),
    [] as UserWordStat[],
  );

  // ── progress (mastered count across all users) ──────────────────────────
  const mastered = await q(
    c,
    "SELECT COUNT(*) n FROM user_words WHERE stage = 'known'",
    (r) => num(r[0]?.n),
    0,
  );

  // ── activity (attempts + daily-active-users) ────────────────────────────
  const totalAttempts = await q(
    c,
    "SELECT COUNT(*) n FROM attempts",
    (r) => num(r[0]?.n),
    0,
  );
  const attemptRows = await q(
    c,
    `SELECT date(ts/1000, 'unixepoch') day,
            COUNT(*) attempts,
            COUNT(DISTINCT user_id) users,
            SUM(CASE WHEN result = 'correct'   THEN 1 ELSE 0 END) correct,
            SUM(CASE WHEN result = 'partial'   THEN 1 ELSE 0 END) partial,
            SUM(CASE WHEN result = 'incorrect' THEN 1 ELSE 0 END) incorrect
       FROM attempts GROUP BY day`,
    (r) =>
      r.map((x) => ({
        day: s(x.day),
        attempts: num(x.attempts),
        users: num(x.users),
        correct: num(x.correct),
        partial: num(x.partial),
        incorrect: num(x.incorrect),
      })),
    [] as { day: string; attempts: number; users: number; correct: number; partial: number; incorrect: number }[],
  );
  const attempts = fillDailySeries(attemptRows, WINDOW_DAYS, now, (r) => r.attempts);
  const activeUsers = fillDailySeries(attemptRows, WINDOW_DAYS, now, (r) => r.users);
  // Per-day result mix (correct / almost / missed) over the window, zero-filled.
  const byDayMap = new Map(attemptRows.map((r) => [r.day, r]));
  const activityByDay: DayBar[] = lastNDaysUTC(WINDOW_DAYS, now).map((day) => {
    const r = byDayMap.get(day);
    return {
      label: shortDayLabel(day),
      total: r?.attempts ?? 0,
      correct: r?.correct ?? 0,
      partial: r?.partial ?? 0,
      incorrect: r?.incorrect ?? 0,
    };
  });
  const activityOverall = activityByDay.reduce(
    (a, d) => ({
      correct: a.correct + d.correct,
      partial: a.partial + d.partial,
      incorrect: a.incorrect + d.incorrect,
      total: a.total + d.total,
    }),
    { correct: 0, partial: 0, incorrect: 0, total: 0 },
  );

  // ── LLM usage / quota consumption ────────────────────────────────────────
  const today = ymdUTC(now);
  const llmByTaskRows = await q(
    c,
    "SELECT task, SUM(count) total FROM llm_usage GROUP BY task",
    (r) => r.map((x) => ({ task: s(x.task), total: num(x.total) })),
    [] as { task: string; total: number }[],
  );
  const byTask = Object.fromEntries(QUOTA_TASKS.map((t) => [t, 0])) as Record<
    QuotaTask,
    number
  >;
  for (const row of llmByTaskRows) {
    if ((QUOTA_TASKS as readonly string[]).includes(row.task))
      byTask[row.task as QuotaTask] = row.total;
  }
  const llmTotal = llmByTaskRows.reduce((a, b) => a + b.total, 0);
  const llmToday = await q(
    c,
    "SELECT SUM(count) n FROM llm_usage WHERE day = ?",
    (r) => num(r[0]?.n),
    0,
    [today],
  );
  // Units per day over the window — the spend trend (is consumption accelerating?).
  // llm_usage.day is already a UTC "YYYY-MM-DD" key, so it lines up with the series.
  const llmDailyRows = await q(
    c,
    "SELECT day, SUM(count) count FROM llm_usage GROUP BY day",
    (r) => r.map((x) => ({ day: s(x.day), count: num(x.count) })),
    [] as { day: string; count: number }[],
  );
  const llmDaily = fillDailySeries(llmDailyRows, WINDOW_DAYS, now);
  const llmWindowTotal = llmDaily.reduce((a, b) => a + b.count, 0);
  const llmTopUsers = await q(
    c,
    `SELECT lu.user_id, SUM(lu.count) total, u.name, u.email
       FROM llm_usage lu
       LEFT JOIN users u ON u.id = lu.user_id
      GROUP BY lu.user_id
      ORDER BY total DESC
      LIMIT 10`,
    (r) =>
      r.map((x) => ({
        user_id: s(x.user_id),
        label: userLabel(x.name, x.email, s(x.user_id)),
        total: num(x.total),
      })),
    [] as LlmUserStat[],
  );

  return {
    generated_at: now,
    window_days: WINDOW_DAYS,
    users: {
      total: usersTotal,
      signups,
      cumulative: cumulative(signups),
      newInWindow: signups.reduce((a, b) => a + b.count, 0),
    },
    vocab: { catalogWords, studiedInstances, distinctStudied, stageCounts, topUsers },
    progress: { mastered },
    activity: {
      totalAttempts,
      attempts,
      activeUsers,
      byDay: activityByDay,
      overall: activityOverall,
    },
    llm: {
      total: llmTotal,
      today: llmToday,
      windowTotal: llmWindowTotal,
      daily: llmDaily,
      byTask,
      topUsers: llmTopUsers,
    },
  };
}
