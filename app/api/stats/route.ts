import { NextResponse } from "next/server";
import { getStore } from "@/lib/store";
import { recentAccuracy, stageCounts } from "@/lib/engine";
import type { Result } from "@/lib/types";

const DAY = 86_400_000;
const DAYS = 14;

function dayStart(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
function label(ts: number): string {
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export async function GET() {
  const store = getStore();
  const words = await store.all();
  const attempts = await store.attempts();

  // ── word-based stats ──
  const total = words.length;
  const practiced = words.filter((w) => w.times_seen > 0).length;
  const mastered = words.filter((w) => w.stage === "known").length;
  const weak = words.filter(
    (w) =>
      w.recent_results.length > 0 &&
      (recentAccuracy(w) < 0.6 ||
        w.recent_results[w.recent_results.length - 1] === "incorrect"),
  ).length;

  const topSeen = [...words]
    .filter((w) => w.times_seen > 0)
    .sort((a, b) => b.times_seen - a.times_seen)
    .slice(0, 10)
    .map((w) => ({ word: w.word, times_seen: w.times_seen }));

  // ── attempt-based stats ──
  const overall: Record<Result, number> = { correct: 0, partial: 0, incorrect: 0 };
  const byTypeMap = new Map<string, Record<Result, number> & { total: number }>();

  // last DAYS days, oldest→newest, zero-filled
  const today = dayStart(Date.now());
  const byDay = Array.from({ length: DAYS }, (_, i) => {
    const ts = today - (DAYS - 1 - i) * DAY;
    return { ts, label: label(ts), total: 0, correct: 0, partial: 0, incorrect: 0 };
  });
  const dayIndex = new Map(byDay.map((d) => [d.ts, d]));

  const activeDays = new Set<number>();
  for (const a of attempts) {
    const r = (["correct", "partial", "incorrect"].includes(a.result)
      ? a.result
      : "incorrect") as Result;
    overall[r]++;

    const type = a.exercise_type || "other";
    const t = byTypeMap.get(type) ?? { total: 0, correct: 0, partial: 0, incorrect: 0 };
    t.total++;
    t[r]++;
    byTypeMap.set(type, t);

    const ds = dayStart(a.ts);
    activeDays.add(ds);
    const bucket = dayIndex.get(ds);
    if (bucket) {
      bucket.total++;
      bucket[r]++;
    }
  }

  // current streak: consecutive days up to today with ≥1 attempt
  let streak = 0;
  for (let d = today; ; d -= DAY) {
    if (activeDays.has(d)) streak++;
    else break;
  }

  const byType = [...byTypeMap.entries()]
    .map(([type, v]) => ({ type, ...v }))
    .sort((a, b) => b.total - a.total);

  return NextResponse.json({
    words: { total, practiced, mastered, weak, stageCounts: stageCounts(words) },
    attempts: {
      total: attempts.length,
      overall,
      byDay: byDay.map(({ ts, ...rest }) => rest),
      byType,
      streak,
    },
    topSeen,
  });
}
