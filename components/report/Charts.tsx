/*
 * Presentational, dependency-free charts for /report. All hand-authored inline
 * SVG / CSS (no chart library), themed entirely with Lexi's design tokens so
 * they render natively in light and dark. Every interactive mark carries a
 * <title> for native hover; status stacks add 2px gaps + labels as the required
 * secondary encoding (the correct/almost/missed trio is below the CVD-safe
 * separation floor, so it is never colour-alone). The maths lives in lib/report.ts.
 */
import type { Stage } from "@/lib/types";

/* ---- small helpers ---- */
function niceDomain(vals: number[], pad = 6): [number, number] {
  if (vals.length === 0) return [0, 100];
  const lo = Math.max(0, Math.min(...vals) - pad);
  const hi = Math.min(100, Math.max(...vals) + pad);
  return [lo, hi === lo ? lo + 1 : hi];
}

/* ── accuracy sparkline (hero) ── */
export function Sparkline({ values }: { values: (number | null)[] }) {
  const W = 240, H = 56, pad = 4;
  const present = values.filter((v): v is number => v != null);
  const [lo, hi] = niceDomain(present, 5);
  const x = (i: number) => pad + i * ((W - 2 * pad) / Math.max(1, values.length - 1));
  const y = (v: number) => H - pad - ((v - lo) / (hi - lo)) * (H - 2 * pad);
  let d = "";
  let first = true;
  const pts: [number, number][] = [];
  values.forEach((v, i) => {
    if (v == null) { first = true; return; }
    const px = x(i), py = y(v);
    pts.push([px, py]);
    d += `${first ? "M" : "L"}${px.toFixed(1)} ${py.toFixed(1)} `;
    first = false;
  });
  if (pts.length === 0) return null;
  const last = pts[pts.length - 1];
  const area = `${d}L ${last[0].toFixed(1)} ${H - pad} L ${pts[0][0].toFixed(1)} ${H - pad} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="56" preserveAspectRatio="none" role="img" aria-label="Daily accuracy trend">
      <path d={area} fill="var(--accent)" fillOpacity="0.12" />
      <path d={d} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r="3.2" fill="var(--accent)" />
    </svg>
  );
}

/* ── daily accuracy trend line ── */
export function AccuracyTrend({ series }: { series: { label: string; total: number; pct: number | null }[] }) {
  const W = 720, H = 132, padL = 30, padR = 8, padT = 10, padB = 22;
  const present = series.map((s) => s.pct).filter((v): v is number => v != null);
  const [lo, hi] = niceDomain(present, 6);
  const x = (i: number) => padL + i * ((W - padL - padR) / Math.max(1, series.length - 1));
  const y = (v: number) => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);
  const ticks = [lo, Math.round((lo + hi) / 2), hi];
  let d = "";
  let first = true;
  series.forEach((s, i) => {
    if (s.pct == null) { first = true; return; }
    d += `${first ? "M" : "L"}${x(i).toFixed(1)} ${y(s.pct).toFixed(1)} `;
    first = false;
  });
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="auto" role="img" aria-label="Daily accuracy over the last 14 days" style={{ display: "block" }}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={padL} y1={y(t)} x2={W - padR} y2={y(t)} stroke="var(--line)" strokeWidth="1" strokeDasharray={t === ticks[1] ? "3 3" : undefined} />
          <text x={padL - 6} y={y(t) + 3} textAnchor="end" fontSize="10" fill="var(--muted)" fontFamily="var(--font-mono), monospace">{t}%</text>
        </g>
      ))}
      <path d={d} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {series.map((s, i) =>
        s.pct == null ? null : (
          <g key={i}>
            <circle cx={x(i)} cy={y(s.pct)} r="3" fill="var(--panel)" stroke="var(--accent)" strokeWidth="2" />
            <circle cx={x(i)} cy={y(s.pct)} r="11" fill="transparent"><title>{`${s.label}: ${s.pct}% accuracy (${s.total} attempts)`}</title></circle>
          </g>
        ),
      )}
      {series.map((s, i) => (i % 2 === 0 ? <text key={`l${i}`} x={x(i)} y={H - 6} textAnchor="middle" fontSize="9" fill="var(--muted)" fontFamily="var(--font-mono), monospace">{s.label}</text> : null))}
    </svg>
  );
}

/* ── daily activity: stacked result-mix columns (2px gaps + hover labels) ── */
export function ActivityColumns({ days }: { days: { label: string; total: number; correct: number; partial: number; incorrect: number }[] }) {
  const W = 720, H = 150, padB = 18, gap = 2;
  const max = Math.max(1, ...days.map((d) => d.total));
  const n = days.length;
  const step = W / n;
  const bw = Math.min(34, step * 0.66);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="auto" role="img" aria-label="Attempts per day, stacked by result" style={{ display: "block" }}>
      {days.map((d, i) => {
        const cx = i * step + step / 2;
        const bx = cx - bw / 2;
        if (d.total === 0) {
          return <rect key={i} x={bx} y={H - padB - 3} width={bw} height={3} rx={1.5} fill="color-mix(in srgb, var(--ink) 9%, transparent)" />;
        }
        const usable = H - padB - 8;
        const h = (d.total / max) * usable;
        const parts: [number, string][] = [[d.correct, "var(--good)"], [d.partial, "var(--warn)"], [d.incorrect, "var(--bad)"]];
        let yCursor = H - padB;
        const rects = parts.map(([v, color], pi) => {
          if (v <= 0) return null;
          const segH = (v / d.total) * h;
          const top = yCursor - segH;
          const rendered = <rect key={pi} x={bx} y={top} width={bw} height={Math.max(1, segH - gap)} rx={2} fill={color} />;
          yCursor = top;
          return rendered;
        });
        return (
          <g key={i}>
            {rects}
            <rect x={i * step} y={0} width={step} height={H - padB} fill="transparent">
              <title>{`${d.label}: ${d.total} attempts — ${d.correct} correct · ${d.partial} almost · ${d.incorrect} missed`}</title>
            </rect>
            {i % 2 === 0 ? <text x={cx} y={H - 5} textAnchor="middle" fontSize="9" fill="var(--muted)" fontFamily="var(--font-mono), monospace">{d.label}</text> : null}
          </g>
        );
      })}
    </svg>
  );
}

/* ── writing band trend (small multiple line, y clamped to a band range) ── */
export function BandTrend({ values, lo = 4, hi = 9 }: { values: number[]; lo?: number; hi?: number }) {
  const W = 320, H = 128, padL = 20, padR = 10, padT = 8, padB = 8;
  if (values.length === 0) return null;
  const x = (i: number) => padL + i * ((W - padL - padR) / Math.max(1, values.length - 1));
  const y = (b: number) => padT + (1 - (b - lo) / (hi - lo)) * (H - padT - padB);
  const gridBands = [5, 6, 7, 8, 9].filter((b) => b >= lo && b <= hi);
  let d = "";
  values.forEach((b, i) => { d += `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(b).toFixed(1)} `; });
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="auto" role="img" aria-label="Band over time" style={{ display: "block" }}>
      {gridBands.map((b) => (
        <g key={b}>
          <line x1={padL} y1={y(b)} x2={W - padR} y2={y(b)} stroke="var(--line)" strokeWidth={b === 7 ? 1.4 : 1} strokeDasharray={b === 7 ? undefined : "3 3"} />
          <text x={4} y={y(b) + 3} fontSize="10" fill="var(--muted)" fontFamily="var(--font-mono), monospace">{b}</text>
        </g>
      ))}
      <path d={d} fill="none" stroke="var(--accent)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      {values.map((b, i) => (
        <g key={i}>
          <circle cx={x(i)} cy={y(b)} r="3.2" fill="var(--accent)" />
          <circle cx={x(i)} cy={y(b)} r="11" fill="transparent"><title>{`Essay ${i + 1}: band ${b.toFixed(1)}`}</title></circle>
        </g>
      ))}
    </svg>
  );
}

/* ── mastery pipeline: one part-to-whole bar, ordinal emerald ramp ── */
export function MasteryPipeline({
  segments, colorOf, labelOf,
}: {
  segments: { stage: Stage; count: number; fraction: number; pct: number }[];
  colorOf: (s: Stage) => string;
  labelOf: (s: Stage) => string;
}) {
  return (
    <div>
      <div style={{ display: "flex", height: 30, borderRadius: 8, overflow: "hidden", border: "1px solid var(--line)" }}>
        {segments.map((s, i) =>
          s.count <= 0 ? null : (
            <div
              key={s.stage}
              title={`${labelOf(s.stage)}: ${s.count} words (${s.pct}%)`}
              style={{
                flexGrow: s.count, flexBasis: 0, minWidth: 2, background: colorOf(s.stage),
                borderLeft: i > 0 ? "2px solid var(--panel)" : undefined,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 11, fontWeight: 700, color: s.stage === "new" ? "var(--ink)" : "#fff",
              }}
            >
              {s.fraction >= 0.1 ? s.count : ""}
            </div>
          ),
        )}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: "6px 14px", marginTop: 12, fontSize: 12 }} className="sm:grid-cols-5">
        {segments.map((s) => (
          <div key={s.stage} className="flex items-center gap-2" style={{ minWidth: 0 }}>
            <span style={{ width: 11, height: 11, borderRadius: 3, background: colorOf(s.stage), flex: "none" }} />
            <span className="tabular-nums" style={{ fontWeight: 700 }}>{s.count}</span>
            <span className="muted" style={{ fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{labelOf(s.stage)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── generic horizontal bars (by-type, most-practiced, mistakes, criteria) ── */
export type HBarRow = { key: string; name: string; widthPct: number; valueLabel: string; color?: string; title?: string; muted?: boolean };
export function HBars({ rows }: { rows: HBarRow[] }) {
  return (
    <div className="space-y-2.5">
      {rows.map((r) => (
        <div key={r.key} className="grid items-center gap-2 sm:gap-3" style={{ gridTemplateColumns: "minmax(96px,150px) 1fr auto" }}>
          <div className="text-sm font-semibold truncate" style={{ minWidth: 0 }} title={r.name}>{r.name}</div>
          <div className="h-3.5 rounded-full overflow-hidden" style={{ background: "color-mix(in srgb, var(--ink) 6%, transparent)" }} title={r.title}>
            <div className="h-full rounded-full" style={{ width: `${Math.max(2, r.widthPct)}%`, background: r.color ?? "var(--accent)" }} />
          </div>
          <div className="text-xs tabular-nums text-right" style={{ minWidth: 72, color: r.muted ? "var(--muted)" : "var(--ink)" }}>{r.valueLabel}</div>
        </div>
      ))}
    </div>
  );
}

/* ── streak dot-strip (KPI tile) ── */
export function StreakStrip({ dots }: { dots: boolean[] }) {
  return (
    <div className="flex gap-1 mt-1.5" aria-hidden="true">
      {dots.map((on, i) => (
        <span key={i} style={{ width: 7, height: 7, borderRadius: 999, flex: "none", background: on ? "var(--accent)" : "color-mix(in srgb, var(--ink) 12%, transparent)" }} />
      ))}
    </div>
  );
}
