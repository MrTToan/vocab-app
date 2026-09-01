/*
 * Pure aggregation helpers for the owner-only admin portal. No DB, no I/O — the
 * SQL in `lib/admin/stats.ts` groups rows by UTC day and these functions shape
 * those grouped rows into the contiguous, zero-filled daily series the dashboard
 * renders. Kept pure so they are unit-testable (see tests/admin.test.ts).
 *
 * Day keys are UTC "YYYY-MM-DD" strings — the same convention `llm_usage.day`
 * uses — so every time-bucketed metric (signups, attempts, active users) lines
 * up on one calendar regardless of server timezone.
 */

const DAY_MS = 86_400_000;

/** UTC "YYYY-MM-DD" for an epoch-ms timestamp. */
export function ymdUTC(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

/** The last `n` UTC day-keys ending today (oldest → newest). */
export function lastNDaysUTC(n: number, now: number = Date.now()): string[] {
  const today = Date.UTC(
    new Date(now).getUTCFullYear(),
    new Date(now).getUTCMonth(),
    new Date(now).getUTCDate(),
  );
  return Array.from({ length: n }, (_, i) => ymdUTC(today - (n - 1 - i) * DAY_MS));
}

/** Short "M/D" label for a "YYYY-MM-DD" key (for compact axis ticks). */
export function shortDayLabel(ymd: string): string {
  const [, m, d] = ymd.split("-");
  return `${Number(m)}/${Number(d)}`;
}

export interface DayCount {
  day: string; // "YYYY-MM-DD"
  count: number;
}
export interface DayPoint {
  day: string;
  label: string;
  count: number;
}

/**
 * Zero-fill grouped {day,count} rows into a contiguous series over the last `n`
 * UTC days (oldest → newest). Rows outside the window are dropped; missing days
 * become 0. `pick` selects the numeric field (defaults to `count`) so the same
 * helper serves attempts, signups, and daily-active-user series.
 */
export function fillDailySeries<T extends { day: string }>(
  rows: T[],
  n: number,
  now: number = Date.now(),
  pick: (r: T) => number = (r) => Number((r as unknown as DayCount).count) || 0,
): DayPoint[] {
  const byDay = new Map<string, number>();
  for (const r of rows) byDay.set(r.day, pick(r));
  return lastNDaysUTC(n, now).map((day) => ({
    day,
    label: shortDayLabel(day),
    count: byDay.get(day) ?? 0,
  }));
}

/** Cumulative running total over a daily series (for a growth curve). */
export function cumulative(series: DayPoint[]): DayPoint[] {
  let acc = 0;
  return series.map((p) => ({ ...p, count: (acc += p.count) }));
}
