"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { STAGE_ORDER, STAGE_LABEL, STAGE_VAR, jsonFetch } from "@/lib/ui";

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
interface Stats {
  words: {
    total: number;
    practiced: number;
    mastered: number;
    weak: number;
    stageCounts: Record<string, number>;
  };
  attempts: {
    total: number;
    overall: { correct: number; partial: number; incorrect: number };
    byDay: DayBar[];
    byType: TypeStat[];
    streak: number;
  };
  topSeen: { word: string; times_seen: number }[];
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

export default function ProgressPage() {
  const [s, setS] = useState<Stats | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    jsonFetch<Stats>("/api/stats").then(setS).catch((e) => setErr(e.message));
  }, []);

  if (err)
    return (
      <div className="card p-4 text-sm" style={{ background: "var(--bad-soft)", borderColor: "var(--bad)" }}>
        {err}
      </div>
    );
  if (!s) return <div className="card p-10 text-center muted">Loading…</div>;

  const { words, attempts, topSeen } = s;
  const acc =
    attempts.total > 0
      ? Math.round(
          ((attempts.overall.correct + attempts.overall.partial * 0.5) /
            attempts.total) *
            100,
        )
      : 0;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-extrabold">Progress</h1>

      {/* ── stat tiles ── */}
      <div className="grid grid-cols-3 gap-3">
        <Tile label="Words" value={words.total} />
        <Tile label="Practiced" value={words.practiced} />
        <Tile label="Mastered" value={words.mastered} accent="var(--good)" />
        <Tile label="Need work" value={words.weak} accent="var(--warn)" />
        <Tile label="Attempts" value={attempts.total} />
        <Tile label="Day streak" value={attempts.streak} accent="var(--accent)" suffix="🔥" />
      </div>

      {/* ── mastery by stage ── */}
      <Section title="Mastery by stage">
        <div className="space-y-2">
          {STAGE_ORDER.map((st) => {
            const n = words.stageCounts[st] ?? 0;
            const pct = words.total ? (n / words.total) * 100 : 0;
            return (
              <div key={st} className="flex items-center gap-3">
                <div className="w-24 text-sm font-semibold">{STAGE_LABEL[st]}</div>
                <div className="flex-1 h-3 rounded-full overflow-hidden bg-black/5 dark:bg-white/10">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${pct}%`, background: STAGE_VAR[st] }}
                  />
                </div>
                <div className="w-8 text-right text-sm muted">{n}</div>
              </div>
            );
          })}
        </div>
      </Section>

      {/* ── daily activity (stacked by result) ── */}
      <Section
        title="Activity — last 14 days"
        subtitle={`Overall accuracy ${acc}%`}
      >
        {attempts.total === 0 ? (
          <Empty />
        ) : (
          <DailyChart days={attempts.byDay} />
        )}
      </Section>

      {/* ── overall accuracy split ── */}
      {attempts.total > 0 && (
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

      {/* ── by exercise type ── */}
      {attempts.byType.length > 0 && (
        <Section title="By exercise type">
          <div className="space-y-3">
            {attempts.byType.map((t) => {
              const a = t.total
                ? Math.round(((t.correct + t.partial * 0.5) / t.total) * 100)
                : 0;
              return (
                <div key={t.type} className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span className="font-semibold">{TYPE_LABEL[t.type] ?? t.type}</span>
                    <span className="muted">
                      {t.total} · {a}% acc
                    </span>
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

      {/* ── most practiced ── */}
      {topSeen.length > 0 && (
        <Section title="Most practiced words">
          <div className="space-y-1.5">
            {topSeen.map((w) => {
              const max = topSeen[0].times_seen || 1;
              return (
                <div key={w.word} className="flex items-center gap-3">
                  <div className="w-32 truncate text-sm font-semibold">{w.word}</div>
                  <div className="flex-1 h-2.5 rounded-full overflow-hidden bg-black/5 dark:bg-white/10">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${(w.times_seen / max) * 100}%`, background: "var(--accent)" }}
                    />
                  </div>
                  <div className="w-6 text-right text-sm muted">{w.times_seen}</div>
                </div>
              );
            })}
          </div>
        </Section>
      )}

      <div className="pt-2">
        <Link href="/practice" className="btn btn-primary">
          Practice →
        </Link>
      </div>
    </div>
  );
}

/* ── pieces ── */

function Tile({
  label,
  value,
  accent,
  suffix,
}: {
  label: string;
  value: number;
  accent?: string;
  suffix?: string;
}) {
  return (
    <div className="card p-3">
      <div className="text-2xl font-extrabold" style={accent ? { color: accent } : undefined}>
        {value}
        {suffix && value > 0 ? ` ${suffix}` : ""}
      </div>
      <div className="muted text-xs">{label}</div>
    </div>
  );
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="card p-5 space-y-3">
      <div className="flex items-baseline justify-between">
        <h2 className="font-bold">{title}</h2>
        {subtitle && <span className="muted text-sm">{subtitle}</span>}
      </div>
      {children}
    </section>
  );
}

function Empty() {
  return <p className="muted text-sm">Practice some words and your activity will show here.</p>;
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
              className="flex-1 flex flex-col justify-end"
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

function StackBar({
  parts,
  total,
  thin,
}: {
  parts: { v: number; c: string; label: string }[];
  total: number;
  thin?: boolean;
}) {
  return (
    <div>
      <div
        className="w-full rounded-full overflow-hidden flex bg-black/5 dark:bg-white/10"
        style={{ height: thin ? 8 : 14 }}
      >
        {parts.map((p, i) =>
          p.v > 0 ? (
            <div
              key={i}
              style={{ width: `${(p.v / total) * 100}%`, background: p.c }}
              title={`${p.label}: ${p.v}`}
            />
          ) : null,
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
