import { NextResponse } from "next/server";
import { writingStore } from "@/lib/writing/store";
import { aggregateErrors } from "@/lib/writing/grade";
import { CRITERIA, type Criterion } from "@/lib/writing/types";

/** Aggregates for the writing side of the cross-skill report. */
export async function GET() {
  const [subs, corrections] = await Promise.all([
    writingStore.submissions(),
    writingStore.allCorrections(),
  ]);

  const chrono = [...subs].sort((a, b) => a.created_at - b.created_at);
  const n = subs.length;

  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

  const avgBands = {} as Record<Criterion, number | null>;
  for (const c of CRITERIA) avgBands[c] = avg(subs.map((s) => s.bands[c]?.band ?? 0));

  return NextResponse.json({
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
  });
}
