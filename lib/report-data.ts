/*
 * Server-side report computation — the single source of truth for the vocabulary
 * and writing aggregates a report shows. Extracted from the /api/stats and
 * /api/writing/stats route handlers so THREE call sites compute an identical
 * payload from one implementation and can never drift:
 *   - GET /api/stats               → vocabStatsFor(callerId)
 *   - GET /api/writing/stats       → writingStatsFor(callerId)
 *   - GET /api/classes/[id]/students/[studentId]/report (route 17, the teacher
 *     view) → both, called with the STUDENT's id after a teachesStudent() check.
 *
 * Both functions take a userId and are otherwise self-scoped exactly as the
 * original routes were; the aggregation math is unchanged (byte-compatible with
 * the previous in-route computation).
 */

import { getStore } from "@/lib/store";
import { writingStore } from "@/lib/writing/store";
import { aggregateErrors } from "@/lib/writing/grade";
import { CRITERIA, type Criterion } from "@/lib/writing/types";
import type { VocabStats, WritingStats } from "@/lib/report";

/** The vocabulary half of the report for one user (the /api/stats body). */
export async function vocabStatsFor(userId: string): Promise<VocabStats> {
  const store = getStore().forUser(userId);
  const [w, attempts] = await Promise.all([
    store.wordStats(),
    store.attemptStats(Date.now()),
  ]);
  return {
    words: {
      total: w.total,
      practiced: w.practiced,
      mastered: w.mastered,
      weak: w.weak,
      stageCounts: w.stageCounts,
    },
    attempts,
    topSeen: w.topSeen,
  };
}

/** The writing half of the report for one user (the /api/writing/stats body). */
export async function writingStatsFor(userId: string): Promise<WritingStats> {
  const store = writingStore.forUser(userId);
  const [subs, corrections] = await Promise.all([
    store.submissions(),
    store.allCorrections(),
  ]);

  const chrono = [...subs].sort((a, b) => a.created_at - b.created_at);
  const n = subs.length;

  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

  const avgBands = {} as Record<Criterion, number | null>;
  for (const c of CRITERIA) avgBands[c] = avg(subs.map((s) => s.bands[c]?.band ?? 0));

  return {
    submissions: n,
    byTask: {
      task1: subs.filter((s) => s.task_type === "task1").length,
      task2: subs.filter((s) => s.task_type === "task2").length,
    },
    avgOverall: avg(subs.map((s) => s.overall_band)),
    avgWordCount: avg(subs.map((s) => s.word_count)),
    avgBands,
    bandSeries: chrono.map((s) => ({
      ts: s.created_at,
      overall: s.overall_band,
      task_type: s.task_type,
    })),
    errorFrequency: aggregateErrors(corrections),
    recent: [...subs]
      .sort((a, b) => b.created_at - a.created_at)
      .slice(0, 8)
      .map((s) => ({
        id: s.id,
        task_type: s.task_type,
        overall_band: s.overall_band,
        word_count: s.word_count,
        created_at: s.created_at,
      })),
  };
}
