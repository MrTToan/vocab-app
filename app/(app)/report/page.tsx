"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { STAGE_ORDER, STAGE_LABEL, STAGE_VAR, stageBarWidth, jsonFetch } from "@/lib/ui";
import {
  CRITERIA,
  CRITERION_LABEL,
  ERROR_LABEL,
  type Criterion,
  type ErrorType,
} from "@/lib/writing/types";
import { bandColor } from "@/components/writing/Feedback";

/* ── types ── */
interface DayBar {
  label: string;
  total: number;
  correct: number;
  partial: number;
  incorrect: number;
}
interface TypeStat {
  type: string;
  total: number;
  correct: number;
  partial: number;
  incorrect: number;
}
interface VocabStats {
  words: { total: number; practiced: number; mastered: number; weak: number; stageCounts: Record<string, number> };
  attempts: {
    total: number;
    overall: { correct: number; partial: number; incorrect: number };
    byDay: DayBar[];
    byType: TypeStat[];
    streak: number;
  };
  topSeen: { word: string; times_seen: number }[];
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

const TYPE_LABEL: Record<string, string> = {
  flashcard: "Flashcard",
  cloze: "Fill-in-the-blank",
  type_from_definition: "Type the word",
  write_sentence: "Write a sentence",
  translate: "Translate",
  scenario: "Scenario",
  other: "Other",
};

export default function ReportPage() {
  const [s, setS] = useState<VocabStats | null>(null);
  const [w, setW] = useState<WritingStats | null>(null);

  useEffect(() => {
    jsonFetch<VocabStats>("/api/stats").then(setS).catch(() => {});
    jsonFetch<WritingStats>("/api/writing/stats").then(setW).catch(() => {});
  }, []);

  const words = s?.words;
  const attempts = s?.attempts;
  const acc =
    attempts && attempts.total > 0
      ? Math.round(((attempts.overall.correct + attempts.overall.partial * 0.5) / attempts.total) * 100)
      : 0;

  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-3xl font-extrabold tracking-tight">Report</h1>
        <p className="muted mt-1">Your progress across every skill in one place.</p>
      </section>

      {/* ── overview tiles (cross-skill) ── */}
      <div className="grid grid-cols-3 md:grid-cols-4 gap-3">
        <Tile label="Words" value={words?.total ?? 0} />
        <Tile label="Practiced" value={words?.practiced ?? 0} />
        <Tile label="Mastered" value={words?.mastered ?? 0} accent="var(--good)" />
        <Tile label="Need work" value={words?.weak ?? 0} accent="var(--warn)" />
        <Tile label="Attempts" value={attempts?.total ?? 0} />
        <Tile label="Day streak" value={attempts?.streak ?? 0} accent="var(--accent)" suffix="🔥" />
        <Tile label="Essays" value={w?.submissions ?? 0} />
        <Tile
          label="Avg band"
          value={w?.avgOverall != null ? w.avgOverall.toFixed(1) : "—"}
          accent={w?.avgOverall != null ? bandColor(w.avgOverall) : undefined}
        />
      </div>

      {/* ══════════ VOCABULARY ══════════ */}
      <h2 className="text-xl font-bold pt-2">Vocabulary</h2>

      <Section title="Mastery by stage" subtitle="New is your not-yet-started backlog; the coloured bars compare your started stages to each other.">
        <div className="space-y-2">
          {STAGE_ORDER.map((st) => {
            const n = words?.stageCounts[st] ?? 0;
            const pct = stageBarWidth(st, words?.stageCounts ?? {});
            const isNew = st === "new";
            return (
              <div key={st} className="flex items-center gap-3">
                <div className="w-24 text-sm font-semibold">{STAGE_LABEL[st]}</div>
                <div className="flex-1 h-3 rounded-full overflow-hidden bg-black/5 dark:bg-white/10">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${pct}%`,
                      background: STAGE_VAR[st],
                      opacity: isNew ? 0.35 : 1,
                    }}
                  />
                </div>
                <div className="w-10 text-right text-sm muted tabular-nums">{n}</div>
              </div>
            );
          })}
        </div>
      </Section>

      <Section title="Activity — last 14 days" subtitle={attempts && attempts.total > 0 ? `Overall accuracy ${acc}%` : undefined}>
        {!attempts || attempts.byDay.every((d) => d.total === 0) ? (
          <p className="muted text-sm">Practice some words and your activity will show here.</p>
        ) : (
          <DailyChart days={attempts.byDay} />
        )}
      </Section>

      {attempts && attempts.total > 0 && (
        <Section title="Answer breakdown">
          <StackBar
            parts={[
              { v: attempts.overall.correct, c: "var(--good)", label: "Correct" },
              { v: attempts.overall.partial, c: "var(--warn)", label: "Almost" },
              { v: attempts.overall.incorrect, c: "var(--bad)", label: "Missed" },
            ]}
            total={attempts.total}
          />
        </Section>
      )}

      {attempts && attempts.byType.length > 0 && (
        <Section title="By exercise type">
          <div className="space-y-3">
            {attempts.byType.map((t) => {
              const a = t.total ? Math.round(((t.correct + t.partial * 0.5) / t.total) * 100) : 0;
              return (
                <div key={t.type} className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span className="font-semibold">{TYPE_LABEL[t.type] ?? t.type}</span>
                    <span className="muted">{t.total} · {a}% acc</span>
                  </div>
                  <StackBar
                    parts={[
                      { v: t.correct, c: "var(--good)", label: "Correct" },
                      { v: t.partial, c: "var(--warn)", label: "Almost" },
                      { v: t.incorrect, c: "var(--bad)", label: "Missed" },
                    ]}
                    total={t.total}
                    thin
                  />
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {s && s.topSeen.length > 0 && (
        <Section title="Most practiced words">
          <div className="space-y-1.5">
            {s.topSeen.map((word) => {
              const max = s.topSeen[0].times_seen || 1;
              return (
                <div key={word.word} className="flex items-center gap-3">
                  <div className="w-32 truncate text-sm font-semibold">{word.word}</div>
                  <div className="flex-1 h-2.5 rounded-full overflow-hidden bg-black/5 dark:bg-white/10">
                    <div className="h-full rounded-full" style={{ width: `${(word.times_seen / max) * 100}%`, background: "var(--accent)" }} />
                  </div>
                  <div className="w-6 text-right text-sm muted">{word.times_seen}</div>
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {/* ══════════ WRITING ══════════ */}
      <h2 className="text-xl font-bold pt-2">Writing (IELTS)</h2>
      {!w || w.submissions === 0 ? (
        <div className="card p-5">
          <div className="font-bold">No essays scored yet</div>
          <p className="muted text-sm mt-1">
            Practise <Link href="/writing" style={{ color: "var(--accent)" }}>Writing</Link> to see band
            trends and your most common mistakes here.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {CRITERIA.map((c) => {
              const b = w.avgBands[c];
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

          <Section title="Overall band over time">
            <div className="flex items-end gap-2 h-36">
              {w.bandSeries.map((p, i) => (
                <div key={i} className="flex-1 flex flex-col items-center justify-end h-full gap-1" title={new Date(p.ts).toLocaleDateString()}>
                  <div className="text-[10px] font-bold" style={{ color: bandColor(p.overall) }}>{p.overall.toFixed(1)}</div>
                  <div className="w-full rounded-t" style={{ height: `${(p.overall / 9) * 100}%`, background: bandColor(p.overall), minHeight: 4 }} />
                  <div className="text-[9px] muted">{p.task_type === "task1" ? "T1" : "T2"}</div>
                </div>
              ))}
            </div>
          </Section>

          <Section title="Most common mistakes">
            <div className="space-y-2">
              {w.errorFrequency.slice(0, 10).map((e) => {
                const max = w.errorFrequency[0]?.count || 1;
                return (
                  <div key={e.error_type} className="flex items-center gap-2 sm:gap-3">
                    <div className="w-28 sm:w-40 text-sm truncate">{ERROR_LABEL[e.error_type]}</div>
                    <div className="flex-1 h-3 rounded-full overflow-hidden bg-black/5 dark:bg-white/10">
                      <div className="h-full rounded-full" style={{ width: `${(e.count / max) * 100}%`, background: "var(--accent)" }} />
                    </div>
                    <div className="w-6 text-right text-sm muted">{e.count}</div>
                  </div>
                );
              })}
            </div>
          </Section>

          <Section title="Recent submissions">
            <div className="divide-y" style={{ borderColor: "var(--line)" }}>
              {w.recent.map((r) => (
                <div key={r.id} className="flex items-center justify-between py-2.5 text-sm" style={{ borderColor: "var(--line)" }}>
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
          </Section>
        </div>
      )}

      <div className="flex gap-2 pt-2">
        <Link href="/practice" className="btn btn-primary">Practice vocabulary →</Link>
        <Link href="/writing" className="btn">Write →</Link>
      </div>
    </div>
  );
}

/* ── shared pieces ── */

function Tile({ label, value, accent, suffix }: { label: string; value: number | string; accent?: string; suffix?: string }) {
  return (
    <div className="card p-3">
      <div className="text-2xl font-extrabold" style={accent ? { color: accent } : undefined}>
        {value}
        {suffix && typeof value === "number" && value > 0 ? ` ${suffix}` : ""}
      </div>
      <div className="muted text-xs">{label}</div>
    </div>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="card p-5 space-y-3">
      <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
        <h3 className="font-bold">{title}</h3>
        {subtitle && <span className="muted text-sm sm:text-right">{subtitle}</span>}
      </div>
      {children}
    </section>
  );
}

function DailyChart({ days }: { days: DayBar[] }) {
  const max = Math.max(1, ...days.map((d) => d.total));
  return (
    <div>
      <div className="flex items-end gap-1.5 h-32">
        {days.map((d, i) => {
          const h = (d.total / max) * 100;
          return (
            <div
              key={i}
              className="flex-1 flex flex-col justify-end h-full"
              title={`${d.label}: ${d.total} (${d.correct}✓ ${d.partial}~ ${d.incorrect}✗)`}
            >
              {d.total === 0 ? (
                <div className="w-full rounded bg-black/5 dark:bg-white/10" style={{ height: 3 }} />
              ) : (
                <div className="w-full rounded overflow-hidden flex flex-col-reverse" style={{ height: `${h}%` }}>
                  <Seg v={d.correct} t={d.total} c="var(--good)" />
                  <Seg v={d.partial} t={d.total} c="var(--warn)" />
                  <Seg v={d.incorrect} t={d.total} c="var(--bad)" />
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="flex gap-1.5 mt-1">
        {days.map((d, i) => (
          <div key={i} className="flex-1 text-center muted" style={{ fontSize: 9 }}>
            {i % 2 === 0 ? d.label : ""}
          </div>
        ))}
      </div>
      <Legend />
    </div>
  );
}

function Seg({ v, t, c }: { v: number; t: number; c: string }) {
  if (v <= 0) return null;
  return <div style={{ height: `${(v / t) * 100}%`, background: c }} />;
}

function StackBar({ parts, total, thin }: { parts: { v: number; c: string; label: string }[]; total: number; thin?: boolean }) {
  return (
    <div>
      <div className="w-full rounded-full overflow-hidden flex bg-black/5 dark:bg-white/10" style={{ height: thin ? 8 : 14 }}>
        {parts.map((p, i) =>
          p.v > 0 ? <div key={i} style={{ width: `${(p.v / total) * 100}%`, background: p.c }} title={`${p.label}: ${p.v}`} /> : null,
        )}
      </div>
      {!thin && (
        <div className="flex gap-4 mt-2 text-xs muted">
          {parts.map((p, i) => (
            <span key={i} className="inline-flex items-center gap-1">
              <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: p.c }} />
              {p.label} {p.v}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function Legend() {
  const items = [
    { c: "var(--good)", l: "Correct" },
    { c: "var(--warn)", l: "Almost" },
    { c: "var(--bad)", l: "Missed" },
  ];
  return (
    <div className="flex gap-4 mt-3 text-xs muted">
      {items.map((it) => (
        <span key={it.l} className="inline-flex items-center gap-1">
          <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: it.c }} />
          {it.l}
        </span>
      ))}
    </div>
  );
}
