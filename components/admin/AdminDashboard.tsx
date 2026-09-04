"use client";

import { useEffect, useMemo, useState } from "react";
import { jsonFetch, STAGE_LABEL } from "@/lib/ui";
import { paginate } from "@/lib/admin/paginate";
import type { AdminStats } from "@/lib/admin/stats";
import type { Stage } from "@/lib/types";
import { masteryPipeline, weightedAccuracyPct, weekOverWeek, STAGE_RAMP } from "@/lib/report";
import { ActivityColumns, MasteryPipeline, HBars, type HBarRow } from "@/components/report/Charts";
import { AreaTrend, CountColumns, MiniSpark, ResultMixBar } from "./Charts";

const USERS_PER_PAGE = 10;

/*
 * Owner-only admin dashboard — an operator's "how is Lexi doing?" view. Renders
 * the aggregate metrics from /api/admin/stats as hand-authored inline SVG (no
 * chart library), themed with Lexi's app tokens (app/globals.css) so it matches
 * /report exactly and adapts to light/dark. Chart FORM follows each metric's job
 * (dataviz skill): a health pulse + accuracy gauge up top; growth as a curve, not
 * bars; activity as a stacked result-mix; mastery as a part-to-whole funnel; LLM
 * spend as a trend. The endpoint is owner-gated; this only ever runs for the
 * owner (the /admin server page gates before rendering it).
 */
export default function AdminDashboard() {
  const [s, setS] = useState<AdminStats | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [userPage, setUserPage] = useState(1);

  useEffect(() => {
    jsonFetch<AdminStats>("/api/admin/stats").then(setS).catch((e) => setErr(String(e.message ?? e)));
  }, []);

  const usersPage = useMemo(
    () => paginate(s?.vocab.topUsers ?? [], userPage, USERS_PER_PAGE),
    [s, userPage],
  );

  if (err) {
    return (
      <div className="card p-6">
        <div className="font-bold">Couldn’t load admin metrics</div>
        <p className="muted text-sm mt-1">{err}</p>
      </div>
    );
  }
  if (!s) return <p className="muted">Loading metrics…</p>;

  const win = s.window_days;
  const windowAttempts = s.activity.attempts.reduce((a, d) => a + d.count, 0);
  const acc = weightedAccuracyPct(s.activity.overall);
  const wow = weekOverWeek(s.activity.byDay);
  const activeToday = s.activity.activeUsers.at(-1)?.count ?? 0;
  const peakDau = Math.max(0, ...s.activity.activeUsers.map((d) => d.count));
  const pipeline = masteryPipeline(s.vocab.stageCounts);
  const llmWoW = seriesWoW(s.llm.daily.map((d) => d.count));

  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-3xl font-extrabold tracking-tight">Admin</h1>
        <p className="muted mt-1">
          Owner-only usage metrics · last {win} days ·{" "}
          <span title={new Date(s.generated_at).toLocaleString()}>
            generated {new Date(s.generated_at).toLocaleTimeString()}
          </span>
        </p>
      </section>

      {/* ══════════ PULSE: the at-a-glance health row ══════════ */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          label="Users"
          value={s.users.total}
          note={s.users.newInWindow > 0 ? `+${s.users.newInWindow} in ${win}d` : "no new signups"}
          spark={s.users.signups.map((d) => d.count)}
        />
        <StatCard
          label="Active today"
          value={activeToday}
          note={`peak ${peakDau}/day · ${win}d`}
          spark={s.activity.activeUsers.map((d) => d.count)}
        />
        <StatCard
          label={`Attempts (${win}d)`}
          value={windowAttempts}
          note={`${s.activity.totalAttempts.toLocaleString()} all-time`}
          spark={s.activity.attempts.map((d) => d.count)}
        />
        <StatCard
          label={`LLM units (${win}d)`}
          value={s.llm.windowTotal}
          note={`${s.llm.today.toLocaleString()} today`}
          spark={s.llm.daily.map((d) => d.count)}
          delta={llmWoW}
          deltaInvert
        />
      </div>

      {/* ── ANSWER QUALITY: the learning-health gauge ── */}
      <section className="card p-5 space-y-4">
        <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
          <h3 className="font-bold">Answer quality</h3>
          <span className="muted text-sm sm:text-right">Weighted accuracy across all learners · last {win} days</span>
        </div>
        {s.activity.overall.total === 0 ? (
          <Empty>No attempts in this window.</Empty>
        ) : (
          <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
            <div>
              <div className="text-5xl font-extrabold leading-none" style={{ color: "var(--accent)" }}>
                {acc}<span className="text-2xl muted font-semibold">%</span>
              </div>
              <div className="muted text-xs mt-1.5">{s.activity.overall.total.toLocaleString()} attempts scored</div>
              {wow.deltaPts != null && wow.deltaPts !== 0 && (
                <div className="text-xs font-bold mt-0.5" style={{ color: wow.deltaPts > 0 ? "var(--good)" : "var(--bad)" }}>
                  {wow.deltaPts > 0 ? "▲" : "▼"} {Math.abs(wow.deltaPts)} pts vs prior week
                </div>
              )}
            </div>
            <div className="flex-1" style={{ minWidth: 220 }}>
              <ResultMixBar
                correct={s.activity.overall.correct}
                partial={s.activity.overall.partial}
                incorrect={s.activity.overall.incorrect}
              />
            </div>
          </div>
        )}
      </section>

      {/* ══════════ GROWTH ══════════ */}
      <h2 className="text-xl font-bold pt-2">Growth</h2>

      <Section title="New signups" subtitle={`${s.users.newInWindow} in the last ${win} days`}>
        {s.users.signups.every((d) => d.count === 0) ? (
          <Empty>No signups in this window.</Empty>
        ) : (
          <CountColumns points={s.users.signups} unit="signups" />
        )}
      </Section>

      <Section title="User growth" subtitle="Cumulative registered users over the window">
        <AreaTrend points={s.users.cumulative} unit="users" />
      </Section>

      {/* ══════════ ENGAGEMENT ══════════ */}
      <h2 className="text-xl font-bold pt-2">Engagement</h2>

      <Section title={`Practice activity — last ${win} days`} subtitle={`${windowAttempts.toLocaleString()} attempts`}>
        {s.activity.byDay.every((d) => d.total === 0) ? (
          <Empty>No attempts in this window.</Empty>
        ) : (
          <div className="space-y-5">
            <div>
              <ActivityColumns days={s.activity.byDay} />
              <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs muted">
                <span className="inline-flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: "var(--good)" }} />Correct</span>
                <span className="inline-flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: "var(--warn)" }} />Almost</span>
                <span className="inline-flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: "var(--bad)" }} />Missed</span>
              </div>
            </div>
            <div>
              <div className="muted text-xs font-bold mb-1">Daily active users</div>
              <CountColumns points={s.activity.activeUsers} unit="users" />
            </div>
          </div>
        )}
      </Section>

      <Section
        title="Most active learners"
        subtitle={`Ranked by words studied · ${usersPage.total} total`}
      >
        {usersPage.total === 0 ? (
          <Empty>No study activity yet.</Empty>
        ) : (
          <>
            <RankBars
              rows={usersPage.items.map((u, i) => ({
                key: u.user_id,
                rank: (usersPage.page - 1) * USERS_PER_PAGE + i + 1,
                label: u.label,
                value: u.studied,
                note: `${u.mastered} mastered`,
              }))}
              max={s.vocab.topUsers[0]?.studied ?? 1}
            />
            <Pager
              page={usersPage.page}
              pageCount={usersPage.pageCount}
              hasPrev={usersPage.hasPrev}
              hasNext={usersPage.hasNext}
              onPrev={() => setUserPage((p) => p - 1)}
              onNext={() => setUserPage((p) => p + 1)}
            />
          </>
        )}
      </Section>

      {/* ══════════ VOCABULARY ══════════ */}
      <h2 className="text-xl font-bold pt-2">Vocabulary</h2>

      <Section
        title="Catalog mastery"
        subtitle="Every studied word across all learners, placed on the New → Known path"
      >
        {pipeline.total === 0 ? (
          <Empty>No words studied yet.</Empty>
        ) : (
          <div className="flex flex-wrap items-center gap-4">
            <div>
              <div className="text-4xl font-extrabold leading-none" style={{ color: "var(--stage-known)" }}>
                {pipeline.knownPct}<span className="text-xl muted font-semibold">%</span>
              </div>
              <div className="muted text-xs mt-1">Known · {pipeline.total.toLocaleString()} words</div>
            </div>
            <div className="flex-1" style={{ minWidth: 220 }}>
              <MasteryPipeline
                segments={pipeline.segments}
                colorOf={(st: Stage) => STAGE_RAMP[st]}
                labelOf={(st: Stage) => STAGE_LABEL[st]}
              />
            </div>
          </div>
        )}
      </Section>

      {/* ══════════ LLM OPERATIONS ══════════ */}
      <h2 className="text-xl font-bold pt-2">LLM operations</h2>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Tile label="Units today" value={s.llm.today} />
        <Tile label={`Units (${win}d)`} value={s.llm.windowTotal} />
        <Tile label="All-time units" value={s.llm.total} />
        <Tile label="Tasks tracked" value={Object.keys(s.llm.byTask).length} />
      </div>

      <Section title="Units over time" subtitle={`${s.llm.windowTotal.toLocaleString()} in the last ${win} days`}>
        {s.llm.daily.every((d) => d.count === 0) ? (
          <Empty>No LLM usage in this window.</Empty>
        ) : (
          <AreaTrend points={s.llm.daily} unit="units" />
        )}
      </Section>

      <Section title="Usage by task" subtitle="All-time units per capped task">
        {(() => {
          const rows = Object.entries(s.llm.byTask)
            .sort((a, b) => b[1] - a[1])
            .filter(([, n]) => n > 0);
          const max = Math.max(1, ...rows.map(([, n]) => n));
          if (rows.length === 0) return <Empty>No LLM usage recorded yet.</Empty>;
          return (
            <HBars
              rows={rows.map(([task, n]): HBarRow => ({
                key: task,
                name: task,
                widthPct: (n / max) * 100,
                valueLabel: n.toLocaleString(),
                muted: true,
                title: `${task}: ${n.toLocaleString()} units`,
              }))}
            />
          );
        })()}
      </Section>

      <Section title="Heaviest consumers" subtitle="By all-time LLM units">
        {s.llm.topUsers.length === 0 ? (
          <Empty>No LLM usage recorded yet.</Empty>
        ) : (
          <RankBars
            rows={s.llm.topUsers.map((u, i) => ({
              key: u.user_id,
              rank: i + 1,
              label: u.label,
              value: u.total,
            }))}
            max={s.llm.topUsers[0]?.total ?? 1}
          />
        )}
      </Section>
    </div>
  );
}

/* ── week-over-week for a raw count series (newest 7 vs prior 7), % change ── */
function seriesWoW(values: number[]): number | null {
  if (values.length < 14) return null;
  const cur = values.slice(-7).reduce((a, b) => a + b, 0);
  const prev = values.slice(-14, -7).reduce((a, b) => a + b, 0);
  if (prev === 0) return cur === 0 ? 0 : null;
  return Math.round(((cur - prev) / prev) * 100);
}

/* ── shared pieces (same visual language as /report) ── */

function StatCard({
  label, value, note, spark, delta, deltaInvert,
}: {
  label: string;
  value: number | string;
  note?: string;
  spark?: number[];
  delta?: number | null; // week-over-week % change
  deltaInvert?: boolean; // true when "up" is a concern (e.g. cost)
}) {
  const up = delta != null && delta > 0;
  const down = delta != null && delta < 0;
  const good = delta == null || delta === 0 ? null : deltaInvert ? down : up;
  return (
    <div className="card p-3 flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-2xl font-extrabold tabular-nums leading-none">
          {typeof value === "number" ? value.toLocaleString() : value}
        </div>
        {delta != null && delta !== 0 && (
          <span className="text-xs font-bold tabular-nums" style={{ color: good ? "var(--good)" : "var(--bad)" }}>
            {up ? "▲" : "▼"}{Math.abs(delta)}%
          </span>
        )}
      </div>
      <div className="muted text-xs">{label}</div>
      {spark && spark.some((v) => v > 0) && <MiniSpark values={spark} />}
      {note && <div className="muted text-xs" style={{ fontWeight: 600 }}>{note}</div>}
    </div>
  );
}

function Tile({ label, value, accent }: { label: string; value: number | string; accent?: string }) {
  return (
    <div className="card p-3">
      <div className="text-2xl font-extrabold tabular-nums" style={accent ? { color: accent } : undefined}>
        {typeof value === "number" ? value.toLocaleString() : value}
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

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="muted text-sm">{children}</p>;
}

function RankBars({
  rows,
  color = "var(--accent)",
  max: maxProp,
}: {
  rows: { key: string; label: string; value: number; note?: string; rank?: number }[];
  color?: string;
  max?: number; // fixed scale (keeps bars comparable across paginated pages)
}) {
  const max = Math.max(1, maxProp ?? Math.max(0, ...rows.map((r) => r.value)));
  return (
    <div className="space-y-1.5">
      {rows.map((r) => (
        <div key={r.key} className="flex items-center gap-2 sm:gap-3">
          {r.rank != null && (
            <div className="w-6 shrink-0 text-right text-sm muted tabular-nums">{r.rank}</div>
          )}
          <div className="w-24 sm:w-40 truncate text-sm font-semibold" title={r.label}>{r.label}</div>
          <div className="flex-1 h-2.5 rounded-full overflow-hidden bg-black/5 dark:bg-white/10">
            <div className="h-full rounded-full" style={{ width: `${(r.value / max) * 100}%`, background: color }} />
          </div>
          <div className="shrink-0 text-right text-sm muted tabular-nums">
            {r.value.toLocaleString()}
            {r.note ? <span className="ml-1 text-xs hidden sm:inline">· {r.note}</span> : ""}
          </div>
        </div>
      ))}
    </div>
  );
}

function Pager({
  page,
  pageCount,
  hasPrev,
  hasNext,
  onPrev,
  onNext,
}: {
  page: number;
  pageCount: number;
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
}) {
  if (pageCount <= 1) return null;
  return (
    <div className="flex items-center justify-between gap-3 pt-1">
      <button className="btn" onClick={onPrev} disabled={!hasPrev} aria-label="Previous page">
        ‹ Prev
      </button>
      <span className="muted text-sm tabular-nums">
        Page {page} of {pageCount}
      </span>
      <button className="btn" onClick={onNext} disabled={!hasNext} aria-label="Next page">
        Next ›
      </button>
    </div>
  );
}
