import { STAGES, type Stage, type Result, type Word, type Attempt } from "./types";
import { recentAccuracy } from "./engine";

/*
 * Shared shapes + pure JS reference implementation for the /api/stats payload.
 *
 * The SQLite store computes these aggregates in SQL (see `wordStats` /
 * `attemptStats` in lib/store.ts) so the route never loads every word/attempt
 * over the wire. The pure functions below are (a) the implementation for the
 * single-user Sheet backend, where everything is already in memory, and (b) the
 * oracle the store tests compare the SQL aggregation against. Keep the key
 * ORDER in the returned objects stable — the JSON response shape is
 * byte-compatible with the original in-JS /api/stats computation.
 */

export const STATS_DAYS = 14;

export type DayBucket = {
  label: string;
  total: number;
  correct: number;
  partial: number;
  incorrect: number;
};
export type TypeBucket = {
  type: string;
  total: number;
  correct: number;
  partial: number;
  incorrect: number;
};
export type TopSeenEntry = { word: string; times_seen: number };

export type WordStats = {
  total: number;
  practiced: number;
  mastered: number;
  weak: number;
  stageCounts: Record<Stage, number>;
  topSeen: TopSeenEntry[];
};

export type AttemptStats = {
  total: number;
  overall: Record<Result, number>;
  byDay: DayBucket[];
  byType: TypeBucket[];
  streak: number;
};

/** Clamp an arbitrary stored result string onto the three known buckets. */
export function normResult(r: string): Result {
  return (["correct", "partial", "incorrect"].includes(r) ? r : "incorrect") as Result;
}

/** "Weak" = has recent results and (accuracy < 0.6 or the last one was wrong). */
export function isWeakRecent(recent_results: Result[]): boolean {
  return (
    recent_results.length > 0 &&
    (recentAccuracy({ recent_results }) < 0.6 ||
      recent_results[recent_results.length - 1] === "incorrect")
  );
}

export function emptyStageCounts(): Record<Stage, number> {
  return Object.fromEntries(STAGES.map((s) => [s, 0])) as Record<Stage, number>;
}

/** Local-calendar day key ("YYYY-MM-DD") — matches SQLite's
 *  `date(ts/1000,'unixepoch','localtime')` as both use the process TZ. */
export function localDayKey(ts: number): string {
  const d = new Date(ts);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** The last `n` local days ending today: `{ key, label }` oldest → newest. */
export function lastNDays(now: number, n = STATS_DAYS): { key: string; label: string }[] {
  const base = new Date(now);
  base.setHours(0, 0, 0, 0);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() - (n - 1 - i));
    return { key: localDayKey(d.getTime()), label: `${d.getMonth() + 1}/${d.getDate()}` };
  });
}

/** Consecutive active local days ending today. */
export function streakFrom(activeDayKeys: ReadonlySet<string>, now: number): number {
  const base = new Date(now);
  base.setHours(0, 0, 0, 0);
  let streak = 0;
  for (let i = 0; ; i++) {
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() - i);
    if (activeDayKeys.has(localDayKey(d.getTime()))) streak++;
    else break;
  }
  return streak;
}

/* ────────────── pure JS reference (Sheet backend + test oracle) ────────────── */

export function computeWordStats(words: Word[]): WordStats {
  const stageCounts = emptyStageCounts();
  for (const w of words) stageCounts[w.stage]++;
  return {
    total: words.length,
    practiced: words.filter((w) => w.times_seen > 0).length,
    mastered: words.filter((w) => w.stage === "known").length,
    weak: words.filter((w) => isWeakRecent(w.recent_results)).length,
    stageCounts,
    topSeen: [...words]
      .filter((w) => w.times_seen > 0)
      .sort((a, b) => b.times_seen - a.times_seen)
      .slice(0, 10)
      .map((w) => ({ word: w.word, times_seen: w.times_seen })),
  };
}

export function computeAttemptStats(attempts: Attempt[], now: number): AttemptStats {
  const overall: Record<Result, number> = { correct: 0, partial: 0, incorrect: 0 };
  const byTypeMap = new Map<string, { total: number; correct: number; partial: number; incorrect: number }>();
  const byDay: DayBucket[] = lastNDays(now).map(({ label }) => ({
    label,
    total: 0,
    correct: 0,
    partial: 0,
    incorrect: 0,
  }));
  const dayIndex = new Map(lastNDays(now).map((d, i) => [d.key, i]));

  const activeDays = new Set<string>();
  for (const a of attempts) {
    const r = normResult(a.result);
    overall[r]++;

    const type = a.exercise_type || "other";
    const t = byTypeMap.get(type) ?? { total: 0, correct: 0, partial: 0, incorrect: 0 };
    t.total++;
    t[r]++;
    byTypeMap.set(type, t);

    const key = localDayKey(a.ts);
    activeDays.add(key);
    const i = dayIndex.get(key);
    if (i !== undefined) {
      byDay[i].total++;
      byDay[i][r]++;
    }
  }

  const byType: TypeBucket[] = [...byTypeMap.entries()]
    .map(([type, v]) => ({ type, ...v }))
    .sort((a, b) => b.total - a.total);

  return {
    total: attempts.length,
    overall,
    byDay,
    byType,
    streak: streakFrom(activeDays, now),
  };
}
