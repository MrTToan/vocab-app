import type { Stage } from "./types";
import { STAGE_ORDER } from "./ui";
import type { DayBucket, TypeBucket } from "./stats";

/*
 * Pure, presentation-free derivations for the /report dashboard.
 *
 * The page renders these; keeping the math here (not inline in the client
 * component) makes the weighted-accuracy, week-over-week, min-attempts guard and
 * mastery-pipeline logic unit-testable (see tests/report.test.ts). Everything
 * consumes the EXISTING /api/stats shapes (lib/stats.ts) — no new server query.
 */

export type ResultBucket = { correct: number; partial: number; incorrect: number };

/** Weighted accuracy 0..1: correct=1, partial=0.5, incorrect=0. 0 when no data. */
export function weightedAccuracy(b: ResultBucket): number {
  const total = b.correct + b.partial + b.incorrect;
  return total <= 0 ? 0 : (b.correct + b.partial * 0.5) / total;
}

/** Weighted accuracy as an integer percent (matches the old inline rounding). */
export function weightedAccuracyPct(b: ResultBucket): number {
  return Math.round(weightedAccuracy(b) * 100);
}

/** Per-day accuracy for the trend line. `pct` is null on days with no attempts
 *  so the line can break (a gap) instead of dropping to zero. */
export function dailyAccuracy(
  byDay: DayBucket[],
): { label: string; total: number; pct: number | null }[] {
  return byDay.map((d) => ({
    label: d.label,
    total: d.total,
    pct: d.total > 0 ? weightedAccuracyPct(d) : null,
  }));
}

/** Week-over-week accuracy: the newest half of the window vs. the older half.
 *  Robust to odd/short windows; either side is null when it had no attempts. */
export function weekOverWeek(byDay: DayBucket[]): {
  current: number | null;
  previous: number | null;
  deltaPts: number | null;
} {
  const n = byDay.length;
  const half = Math.floor(n / 2);
  const sum = (arr: DayBucket[]): ResultBucket =>
    arr.reduce(
      (a, d) => ({
        correct: a.correct + d.correct,
        partial: a.partial + d.partial,
        incorrect: a.incorrect + d.incorrect,
      }),
      { correct: 0, partial: 0, incorrect: 0 },
    );
  const prevB = sum(byDay.slice(0, half));
  const curB = sum(byDay.slice(n - half));
  const has = (b: ResultBucket) => b.correct + b.partial + b.incorrect > 0;
  const current = has(curB) ? weightedAccuracyPct(curB) : null;
  const previous = has(prevB) ? weightedAccuracyPct(prevB) : null;
  return {
    current,
    previous,
    deltaPts: current != null && previous != null ? current - previous : null,
  };
}

export type RankedType = {
  type: string;
  total: number;
  pct: number;
  lowSample: boolean;
};

/** Exercise types ranked weakest-first for the "where to focus" chart. Types
 *  below `minAttempts` are flagged `lowSample` and sorted AFTER the reliable
 *  ones, so a 2-attempt type can never top the "you're weak here" list. */
export function rankTypesByAccuracy(
  byType: TypeBucket[],
  minAttempts = 10,
): RankedType[] {
  return byType
    .map((t) => ({
      type: t.type,
      total: t.total,
      pct: weightedAccuracyPct(t),
      lowSample: t.total < minAttempts,
    }))
    .sort(
      (a, b) =>
        Number(a.lowSample) - Number(b.lowSample) || // reliable first
        a.pct - b.pct || // weakest first
        b.total - a.total, // then higher volume
    );
}

export type PipelineSegment = {
  stage: Stage;
  count: number;
  fraction: number; // 0..1 of the whole vocabulary (exact — for bar widths)
  pct: number; // rounded, for labels
};

/** The mastery "climb": every word placed on the New→Known pipeline as one
 *  part-to-whole bar. `fraction` is exact (widths sum to 1); `pct` is rounded
 *  for labels. `knownPct` is the headline "how close am I?" number. */
export function masteryPipeline(stageCounts: Record<string, number>): {
  segments: PipelineSegment[];
  total: number;
  knownPct: number;
} {
  const total = STAGE_ORDER.reduce((s, st) => s + (stageCounts[st] ?? 0), 0);
  const segments = STAGE_ORDER.map((stage) => {
    const count = stageCounts[stage] ?? 0;
    const fraction = total > 0 ? count / total : 0;
    return { stage, count, fraction, pct: Math.round(fraction * 100) };
  });
  return {
    segments,
    total,
    knownPct: total > 0 ? Math.round(((stageCounts["known"] ?? 0) / total) * 100) : 0,
  };
}

/** Which of the last N days were active (≥1 attempt) — the streak dot-strip. */
export function streakDots(byDay: DayBucket[]): boolean[] {
  return byDay.map((d) => d.total > 0);
}

/**
 * Report-scoped ordinal colour ramp for the mastery pipeline (New→Known).
 * One emerald hue, monotone lightness = "deeper green is closer to mastery",
 * with every stage a DISTINCT step (the old STAGE_VAR mapped recall+production
 * to the same --accent). Tokens live in app/globals.css; both light and dark
 * ramps were validated with the dataviz palette validator (ordinal checks pass:
 * monotone L, ΔL ≥ 0.06, single hue, light-end contrast). Kept separate from
 * STAGE_VAR so the library/vocab chips are untouched.
 */
export const STAGE_RAMP: Record<Stage, string> = {
  new: "var(--stage-new)",
  recognition: "var(--stage-recognition)",
  recall: "var(--stage-recall)",
  production: "var(--stage-production)",
  known: "var(--stage-known)",
};
