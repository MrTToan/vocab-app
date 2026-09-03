import Link from "next/link";
import { STAGE_LABEL } from "@/lib/ui";
import {
  CRITERIA,
  CRITERION_LABEL,
  ERROR_LABEL,
} from "@/lib/writing/types";
import { bandColor } from "@/components/writing/Feedback";
import type { Stage } from "@/lib/types";
import {
  weightedAccuracyPct,
  dailyAccuracy,
  weekOverWeek,
  rankTypesByAccuracy,
  masteryPipeline,
  streakDots,
  STAGE_RAMP,
  type VocabStats,
  type WritingStats,
} from "@/lib/report";
import {
  Sparkline,
  AccuracyTrend,
  ActivityColumns,
  BandTrend,
  MasteryPipeline,
  HBars,
  StreakStrip,
  type HBarRow,
} from "@/components/report/Charts";

export type { VocabStats, WritingStats };

const TYPE_LABEL: Record<string, string> = {
  multiple_choice: "Multiple choice",
  flashcard: "Flashcard",
  cloze: "Fill-in-the-blank",
  type_from_definition: "Type the word",
  write_sentence: "Write a sentence",
  translate: "Translate",
  scenario: "Scenario",
  other: "Other",
};

/*
 * The presentational body of the report — every tile and chart (hero, KPI row,
 * mastery pipeline, activity, by-type, writing charts). Extracted verbatim from
 * app/(app)/report/page.tsx so it can be fed from TWO sources with IDENTICAL
 * output: the learner's own /report (own SWR keys) and the teacher's read-only
 * view of a student (route 17). It is PURE — takes { vocab, writing } and owns no
 * data fetching, header, or navigation CTA; the page around it supplies those.
 * A refactor for /report (no visual change), and the whole render for the
 * teacher page.
 */
export default function ReportView({
  vocab,
  writing,
}: {
  vocab: VocabStats | null;
  writing: WritingStats | null;
}) {
  const s = vocab;
  const w = writing;

  const words = s?.words;
  const attempts = s?.attempts;
  const hasAttempts = !!attempts && attempts.total > 0;
  const overallAcc = attempts ? weightedAccuracyPct(attempts.overall) : 0;
  const daily = attempts ? dailyAccuracy(attempts.byDay) : [];
  const wow = attempts ? weekOverWeek(attempts.byDay) : { current: null, previous: null, deltaPts: null };
  const windowTotal = attempts ? attempts.byDay.reduce((a, d) => a + d.total, 0) : 0;

  const pipeline = words ? masteryPipeline(words.stageCounts) : null;

  return (
    <>
      {/* ── HERO: how you're doing (accuracy + trend + overall mix) ── */}
      <section className="card p-5 space-y-4">
        <div className="sechead flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h3 className="font-bold">How you&rsquo;re doing</h3>
          <span className="muted text-sm">Vocabulary · last 14 days</span>
        </div>
        {!hasAttempts ? (
          <p className="muted text-sm">Practise some words and your accuracy trend will appear here.</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
              <div>
                <div className="text-5xl font-extrabold leading-none" style={{ color: "var(--accent)" }}>
                  {overallAcc}<span className="text-2xl muted font-semibold">%</span>
                </div>
                <div className="muted text-xs mt-1.5">weighted accuracy · all time</div>
                {wow.deltaPts != null && wow.deltaPts !== 0 && (
                  <div className="text-xs font-bold mt-0.5" style={{ color: wow.deltaPts > 0 ? "var(--good)" : "var(--bad)" }}>
                    {wow.deltaPts > 0 ? "▲" : "▼"} {Math.abs(wow.deltaPts)} pts vs last week
                  </div>
                )}
              </div>
              <div className="flex-1" style={{ minWidth: 160, maxWidth: 360 }}>
                <Sparkline values={daily.map((d) => d.pct)} />
              </div>
            </div>
            {/* overall answer breakdown — status trio with 2px gaps + labels (secondary encoding) */}
            <div>
              <div className="w-full rounded-full overflow-hidden flex" style={{ height: 14, background: "color-mix(in srgb, var(--ink) 6%, transparent)", gap: 2 }}>
                {([["correct", "var(--good)"], ["partial", "var(--warn)"], ["incorrect", "var(--bad)"]] as const).map(([k, c]) =>
                  attempts!.overall[k] > 0 ? (
                    <div key={k} style={{ width: `${(attempts!.overall[k] / attempts!.total) * 100}%`, background: c }} title={`${attempts!.overall[k]}`} />
                  ) : null,
                )}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs muted">
                <span className="inline-flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: "var(--good)" }} />Correct {attempts!.overall.correct}</span>
                <span className="inline-flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: "var(--warn)" }} />Almost {attempts!.overall.partial}</span>
                <span className="inline-flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: "var(--bad)" }} />Missed {attempts!.overall.incorrect}</span>
              </div>
            </div>
          </>
        )}
      </section>

      {/* ── KPI row (4) ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Tile label="Words" value={words?.total ?? 0} />
        <Tile label="Mastered" value={words?.mastered ?? 0} accent="var(--good)" />
        <div className="card p-3">
          <div className="text-2xl font-extrabold" style={{ color: "var(--accent)" }}>
            {attempts?.streak ?? 0}{(attempts?.streak ?? 0) > 0 ? " 🔥" : ""}
          </div>
          <div className="muted text-xs">Day streak</div>
          {attempts && <StreakStrip dots={streakDots(attempts.byDay)} />}
        </div>
        <Tile label="Attempts" value={attempts?.total ?? 0} suffixNote={(words?.weak ?? 0) > 0 ? `${words!.weak} need work` : undefined} />
      </div>

      {/* ══════════ VOCABULARY ══════════ */}
      <h2 className="text-xl font-bold pt-2">Vocabulary</h2>

      {/* MASTERY PIPELINE */}
      <Section title="Your climb to mastery" subtitle="Every word placed on the path from New to Known. Deeper green is closer to mastery.">
        {!pipeline || pipeline.total === 0 ? (
          <p className="muted text-sm">Add words to start your climb.</p>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-4">
              <div>
                <div className="text-4xl font-extrabold leading-none" style={{ color: "var(--stage-known)" }}>
                  {pipeline.knownPct}<span className="text-xl muted font-semibold">%</span>
                </div>
                <div className="muted text-xs mt-1">Known</div>
              </div>
              <div className="flex-1" style={{ minWidth: 220 }}>
                <MasteryPipeline
                  segments={pipeline.segments}
                  colorOf={(st: Stage) => STAGE_RAMP[st]}
                  labelOf={(st: Stage) => STAGE_LABEL[st]}
                />
              </div>
            </div>
          </div>
        )}
      </Section>

      {/* ACTIVITY: volume columns + separate accuracy line */}
      <Section
        title="Practice activity — last 14 days"
        subtitle={hasAttempts ? `${windowTotal} attempts` : undefined}
      >
        {!hasAttempts || attempts!.byDay.every((d) => d.total === 0) ? (
          <p className="muted text-sm">Practice some words and your activity will show here.</p>
        ) : (
          <div className="space-y-4">
            <div>
              <ActivityColumns days={attempts!.byDay} />
              <div className="flex gap-4 mt-2 text-xs muted">
                <span className="inline-flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: "var(--good)" }} />Correct</span>
                <span className="inline-flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: "var(--warn)" }} />Almost</span>
                <span className="inline-flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: "var(--bad)" }} />Missed</span>
              </div>
            </div>
            <div>
              <div className="muted text-xs font-bold mb-1">Daily accuracy</div>
              <AccuracyTrend series={daily} />
            </div>
          </div>
        )}
      </Section>

      {/* WHERE TO FOCUS: accuracy by type, weakest-first */}
      {attempts && attempts.byType.length > 0 && (
        <Section title="Where to focus" subtitle="Accuracy by exercise type — weakest first">
          <HBars rows={rankTypesByAccuracy(attempts.byType).map((t): HBarRow => ({
            key: t.type,
            name: TYPE_LABEL[t.type] ?? t.type,
            widthPct: t.pct,
            valueLabel: `${t.pct}% · ${t.total}${t.lowSample ? " · low" : ""}`,
            color: "var(--accent)",
            muted: true,
            title: `${TYPE_LABEL[t.type] ?? t.type}: ${t.pct}% accuracy over ${t.total} attempts${t.lowSample ? " (low sample)" : ""}`,
          }))} />
        </Section>
      )}

      {/* MOST PRACTICED */}
      {s && s.topSeen.length > 0 && (
        <Section title="Most practiced words">
          <HBars rows={s.topSeen.map((word): HBarRow => {
            const max = s.topSeen[0].times_seen || 1;
            return {
              key: word.word,
              name: word.word,
              widthPct: (word.times_seen / max) * 100,
              valueLabel: String(word.times_seen),
              color: "var(--accent)",
              muted: true,
              title: `${word.word}: practised ${word.times_seen}×`,
            };
          })} />
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
          {/* writing summary tiles (moved here, in context) */}
          <div className="grid grid-cols-3 gap-3">
            <Tile label="Essays" value={w.submissions} />
            <Tile label="Avg band" value={w.avgOverall != null ? w.avgOverall.toFixed(1) : "—"} accent={w.avgOverall != null ? bandColor(w.avgOverall) : undefined} />
            <Tile label="Avg words" value={w.avgWordCount != null ? Math.round(w.avgWordCount) : 0} />
          </div>

          <Section title="Band by criterion" subtitle="Average over your essays · out of 9">
            <HBars rows={CRITERIA.map((c): HBarRow => {
              const b = w.avgBands[c];
              return {
                key: c,
                name: CRITERION_LABEL[c],
                widthPct: b != null ? (b / 9) * 100 : 0,
                valueLabel: b != null ? b.toFixed(1) : "—",
                color: b != null ? bandColor(b) : "var(--muted)",
                title: b != null ? `${CRITERION_LABEL[c]}: band ${b.toFixed(1)}` : `${CRITERION_LABEL[c]}: not scored`,
              };
            })} />
          </Section>

          <Section title="Band over time" subtitle="By task · band scale 4–9">
            <WritingTrends bandSeries={w.bandSeries} byTask={w.byTask} />
          </Section>

          <Section title="Most common mistakes" subtitle="Your focus areas across every essay">
            {w.errorFrequency.length === 0 ? (
              <p className="muted text-sm">No mistakes logged yet — keep writing.</p>
            ) : (
              <HBars rows={w.errorFrequency.slice(0, 10).map((e): HBarRow => {
                const max = w.errorFrequency[0]?.count || 1;
                return {
                  key: e.error_type,
                  name: ERROR_LABEL[e.error_type],
                  widthPct: (e.count / max) * 100,
                  valueLabel: String(e.count),
                  color: "var(--accent)",
                  muted: true,
                  title: `${ERROR_LABEL[e.error_type]}: ${e.count}×`,
                };
              })} />
            )}
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
    </>
  );
}

/* ── shared pieces ── */

function Tile({ label, value, accent, suffixNote }: { label: string; value: number | string; accent?: string; suffixNote?: string }) {
  return (
    <div className="card p-3">
      <div className="text-2xl font-extrabold" style={accent ? { color: accent } : undefined}>{value}</div>
      <div className="muted text-xs">{label}</div>
      {suffixNote && <div className="muted text-xs mt-0.5" style={{ fontWeight: 600 }}>{suffixNote}</div>}
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

/* Writing band trend split into Task 1 / Task 2 small multiples. */
function WritingTrends({ bandSeries, byTask }: { bandSeries: { overall: number; task_type: string }[]; byTask: { task1: number; task2: number } }) {
  const t1 = bandSeries.filter((p) => p.task_type === "task1").map((p) => p.overall);
  const t2 = bandSeries.filter((p) => p.task_type === "task2").map((p) => p.overall);
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      {([["Task 1", t1, byTask.task1], ["Task 2", t2, byTask.task2]] as const).map(([label, vals, n]) => (
        <div key={label}>
          <div className="text-sm font-semibold">{label}</div>
          <div className="muted text-xs mb-1">{n} {n === 1 ? "essay" : "essays"}</div>
          {vals.length > 0 ? <BandTrend values={vals} /> : <p className="muted text-sm py-6">No {label} essays yet.</p>}
        </div>
      ))}
    </div>
  );
}
