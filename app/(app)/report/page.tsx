"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { STAGE_ORDER, STAGE_LABEL, STAGE_VAR, jsonFetch } from "@/lib/ui";
import {
  CRITERIA,
  CRITERION_LABEL,
  ERROR_LABEL,
  type Criterion,
  type ErrorType,
} from "@/lib/writing/types";
import { bandColor } from "@/components/writing/Feedback";

interface VocabStats {
  words: { total: number; weak: number; stageCounts: Record<string, number> };
}
interface WritingStats {
  submissions: number;
  byTask: { task1: number; task2: number };
  avgOverall: number | null;
  avgWordCount: number | null;
  avgBands: Record<Criterion, number | null>;
  bandSeries: { ts: number; overall: number; task_type: string }[];
  errorFrequency: { error_type: ErrorType; count: number }[];
  recent: { id: string; task_type: string; overall_band: number; word_count: number; created_at: number }[];
}

export default function ReportPage() {
  const [vocab, setVocab] = useState<VocabStats | null>(null);
  const [writing, setWriting] = useState<WritingStats | null>(null);

  useEffect(() => {
    jsonFetch<VocabStats>("/api/stats").then(setVocab).catch(() => {});
    jsonFetch<WritingStats>("/api/writing/stats").then(setWriting).catch(() => {});
  }, []);

  const words = vocab?.words.total ?? 0;
  const weak = vocab?.words.weak ?? 0;

  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-3xl font-extrabold tracking-tight">Report</h1>
        <p className="muted mt-1">Your progress across every skill in one place.</p>
      </section>

      {/* Overview tiles */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile label="Words" value={words} />
        <Tile label="Need work" value={weak} color="var(--warn)" />
        <Tile label="Essays scored" value={writing?.submissions ?? 0} />
        <Tile
          label="Avg band"
          value={writing?.avgOverall != null ? writing.avgOverall.toFixed(1) : "—"}
          color={writing?.avgOverall != null ? bandColor(writing.avgOverall) : undefined}
        />
      </section>

      {/* Vocabulary */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xl font-bold">Vocabulary</h2>
          <Link href="/progress" className="text-sm font-semibold" style={{ color: "var(--accent)" }}>
            Full vocabulary charts →
          </Link>
        </div>
        <div className="card p-5 space-y-2">
          {STAGE_ORDER.map((s) => {
            const n = vocab?.words.stageCounts[s] ?? 0;
            return (
              <div key={s} className="flex items-center gap-3">
                <div className="w-24 text-sm font-semibold">{STAGE_LABEL[s]}</div>
                <div className="flex-1 h-2.5 rounded-full overflow-hidden bg-black/5 dark:bg-white/10">
                  <div className="h-full rounded-full" style={{ width: words ? `${(n / words) * 100}%` : "0%", background: STAGE_VAR[s] }} />
                </div>
                <div className="w-8 text-right text-sm muted">{n}</div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Writing */}
      <section>
        <h2 className="text-xl font-bold mb-3">Writing (IELTS)</h2>
        {!writing || writing.submissions === 0 ? (
          <div className="card p-5">
            <div className="font-bold">No essays scored yet</div>
            <p className="muted text-sm mt-1">
              Practise <Link href="/writing" style={{ color: "var(--accent)" }}>Writing</Link> to see band
              trends and your most common mistakes here.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Average band per criterion */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {CRITERIA.map((c) => {
                const b = writing.avgBands[c];
                return (
                  <div key={c} className="card p-4 text-center">
                    <div className="text-2xl font-extrabold" style={{ color: b != null ? bandColor(b) : "var(--muted)" }}>
                      {b != null ? b.toFixed(1) : "—"}
                    </div>
                    <div className="text-xs muted mt-1">{CRITERION_LABEL[c]}</div>
                  </div>
                );
              })}
            </div>

            {/* Band trend */}
            <div>
              <h3 className="font-bold text-sm mb-2">Overall band over time</h3>
              <div className="card p-4 flex items-end gap-2" style={{ minHeight: 140 }}>
                {writing.bandSeries.map((p, i) => (
                  <div key={i} className="flex-1 flex flex-col items-center justify-end gap-1" title={new Date(p.ts).toLocaleDateString()}>
                    <div className="text-[10px] font-bold" style={{ color: bandColor(p.overall) }}>{p.overall.toFixed(1)}</div>
                    <div className="w-full rounded-t" style={{ height: `${(p.overall / 9) * 100}px`, background: bandColor(p.overall), minHeight: 4 }} />
                    <div className="text-[9px] muted">{p.task_type === "task1" ? "T1" : "T2"}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Error frequency — the review view */}
            <div>
              <h3 className="font-bold text-sm mb-2">Most common mistakes</h3>
              <div className="card p-4 space-y-2">
                {writing.errorFrequency.slice(0, 10).map((e) => {
                  const max = writing.errorFrequency[0]?.count || 1;
                  return (
                    <div key={e.error_type} className="flex items-center gap-3">
                      <div className="w-40 text-sm truncate">{ERROR_LABEL[e.error_type]}</div>
                      <div className="flex-1 h-3 rounded-full overflow-hidden bg-black/5 dark:bg-white/10">
                        <div className="h-full rounded-full" style={{ width: `${(e.count / max) * 100}%`, background: "var(--accent)" }} />
                      </div>
                      <div className="w-6 text-right text-sm muted">{e.count}</div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Recent submissions */}
            <div>
              <h3 className="font-bold text-sm mb-2">Recent submissions</h3>
              <div className="card divide-y" style={{ borderColor: "var(--line)" }}>
                {writing.recent.map((r) => (
                  <div key={r.id} className="flex items-center justify-between px-4 py-2.5 text-sm" style={{ borderColor: "var(--line)" }}>
                    <div className="flex items-center gap-2">
                      <span className="chip">{r.task_type === "task1" ? "Task 1" : "Task 2"}</span>
                      <span className="muted">{r.word_count} words</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="muted text-xs">{new Date(r.created_at).toLocaleDateString()}</span>
                      <span className="font-extrabold" style={{ color: bandColor(r.overall_band) }}>{r.overall_band.toFixed(1)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function Tile({ label, value, color }: { label: string; value: number | string; color?: string }) {
  return (
    <div className="card p-4">
      <div className="text-3xl font-extrabold" style={color ? { color } : undefined}>{value}</div>
      <div className="muted text-sm mt-0.5">{label}</div>
    </div>
  );
}
