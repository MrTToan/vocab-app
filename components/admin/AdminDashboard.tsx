"use client";

import { useEffect, useMemo, useState } from "react";
import { jsonFetch } from "@/lib/ui";
import { paginate } from "@/lib/admin/paginate";
import type { AdminStats } from "@/lib/admin/stats";

const USERS_PER_PAGE = 10;

/*
 * Owner-only admin dashboard. Renders the aggregate metrics from
 * /api/admin/stats using the same hand-built tile/bar style as /report (no chart
 * library). The endpoint is owner-gated; this component only ever runs for the
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

  const maxLlmTask = Math.max(1, ...Object.values(s.llm.byTask));

  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-3xl font-extrabold tracking-tight">Admin</h1>
        <p className="muted mt-1">
          Owner-only usage metrics · last {s.window_days} days ·{" "}
          <span title={new Date(s.generated_at).toLocaleString()}>
            generated {new Date(s.generated_at).toLocaleTimeString()}
          </span>
        </p>
      </section>

      {/* ── overview tiles ── */}
      <div className="grid grid-cols-3 md:grid-cols-4 gap-3">
        <Tile label="Users" value={s.users.total} />
        <Tile label={`New (${s.window_days}d)`} value={s.users.newInWindow} accent="var(--accent)" />
        <Tile label="Words in catalog" value={s.vocab.catalogWords} />
        <Tile label="Words studied" value={s.vocab.studiedInstances} />
        <Tile label="Distinct studied" value={s.vocab.distinctStudied} />
        <Tile label="Mastered" value={s.progress.mastered} accent="var(--good)" />
        <Tile label="Attempts" value={s.activity.totalAttempts} />
        <Tile label="LLM units" value={s.llm.total} accent="var(--warn)" />
      </div>

      {/* ══════════ USERS ══════════ */}
      <h2 className="text-xl font-bold pt-2">Users</h2>

      <Section title="New signups" subtitle={`${s.users.newInWindow} in the last ${s.window_days} days`}>
        {s.users.signups.every((d) => d.count === 0) ? (
          <Empty>No signups in this window.</Empty>
        ) : (
          <BarChart points={s.users.signups} color="var(--accent)" />
        )}
      </Section>

      <Section title="Cumulative users" subtitle="Running total over the window">
        <BarChart points={s.users.cumulative} color="var(--accent)" />
      </Section>

      <Section
        title="Most active users"
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

      {/* ══════════ ACTIVITY ══════════ */}
      <h2 className="text-xl font-bold pt-2">Activity</h2>

      <Section title="Attempts per day" subtitle="The v1 traffic signal (a free proxy — no page-view tracking)">
        {s.activity.attempts.every((d) => d.count === 0) ? (
          <Empty>No attempts in this window.</Empty>
        ) : (
          <BarChart points={s.activity.attempts} color="var(--good)" />
        )}
      </Section>

      <Section title="Daily active users" subtitle="Distinct users with ≥1 attempt">
        {s.activity.activeUsers.every((d) => d.count === 0) ? (
          <Empty>No active users in this window.</Empty>
        ) : (
          <BarChart points={s.activity.activeUsers} color="var(--accent)" />
        )}
      </Section>

      {/* ══════════ LLM USAGE ══════════ */}
      <h2 className="text-xl font-bold pt-2">LLM usage</h2>

      <div className="grid grid-cols-3 gap-3">
        <Tile label="All-time units" value={s.llm.total} />
        <Tile label="Today (UTC)" value={s.llm.today} accent="var(--warn)" />
        <Tile label="Tasks tracked" value={Object.keys(s.llm.byTask).length} />
      </div>

      <Section title="Usage by task" subtitle="All-time units per capped task">
        <div className="space-y-2">
          {Object.entries(s.llm.byTask).map(([task, n]) => (
            <div key={task} className="flex items-center gap-3">
              <div className="w-28 text-sm font-semibold">{task}</div>
              <div className="flex-1 h-3 rounded-full overflow-hidden bg-black/5 dark:bg-white/10">
                <div className="h-full rounded-full" style={{ width: `${(n / maxLlmTask) * 100}%`, background: "var(--warn)" }} />
              </div>
              <div className="w-12 text-right text-sm muted tabular-nums">{n}</div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Heaviest consumers" subtitle="By all-time LLM units">
        {s.llm.topUsers.length === 0 ? (
          <Empty>No LLM usage recorded yet.</Empty>
        ) : (
          <RankBars
            rows={s.llm.topUsers.map((u) => ({ key: u.user_id, label: u.label, value: u.total }))}
            color="var(--warn)"
          />
        )}
      </Section>
    </div>
  );
}

/* ── shared pieces (same visual language as /report) ── */

function Tile({ label, value, accent }: { label: string; value: number | string; accent?: string }) {
  return (
    <div className="card p-3">
      <div className="text-2xl font-extrabold tabular-nums" style={accent ? { color: accent } : undefined}>
        {value}
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

interface Point {
  day: string;
  label: string;
  count: number;
}

function BarChart({ points, color }: { points: Point[]; color: string }) {
  const max = Math.max(1, ...points.map((p) => p.count));
  return (
    <div>
      <div className="flex items-end gap-1 h-32">
        {points.map((p, i) => (
          <div
            key={p.day}
            className="flex-1 flex flex-col justify-end h-full"
            title={`${p.day}: ${p.count}`}
          >
            {p.count === 0 ? (
              <div className="w-full rounded bg-black/5 dark:bg-white/10" style={{ height: 3 }} />
            ) : (
              <div className="w-full rounded-t" style={{ height: `${(p.count / max) * 100}%`, background: color, minHeight: 2 }} />
            )}
          </div>
        ))}
      </div>
      <div className="flex gap-1 mt-1">
        {points.map((p, i) => (
          <div key={p.day} className="flex-1 text-center muted" style={{ fontSize: 9 }}>
            {i % 5 === 0 ? p.label : ""}
          </div>
        ))}
      </div>
    </div>
  );
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
            {r.value}
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
