/*
 * Admin-only, dependency-free charts for the owner dashboard. Hand-authored
 * inline SVG themed entirely with Lexi's app design tokens (app/globals.css) so
 * they render natively in light and dark — the same visual language as the
 * /report charts (components/report/Charts.tsx), which the dashboard also reuses
 * directly (ActivityColumns, MasteryPipeline, HBars).
 *
 * These add the COUNT-scaled forms /report doesn't need: the report line/spark
 * charts clamp their domain to 0–100 (they plot accuracy percentages), so raw
 * operational counts (users, attempts, LLM units) need their own [0, max]-scaled
 * primitives. Every interactive mark carries a <title> for native hover.
 */

/** A single point on a daily series: a short "M/D" label + a value. */
export interface CountPoint {
  label: string;
  count: number;
}

function niceMax(vals: number[]): number {
  const raw = Math.max(1, ...vals);
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * pow;
}

const fmt = (n: number): string =>
  n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n);

/* ── filled area-line trend (growth curve, spend curve) ──
   The right form for a running total or a cumulative/rate-over-time signal —
   a line, not bars. Count-scaled y-axis with a 0 baseline and a nice top tick. */
export function AreaTrend({
  points,
  color = "var(--accent)",
  unit = "",
}: {
  points: CountPoint[];
  color?: string;
  unit?: string;
}) {
  const W = 720, H = 150, padL = 34, padR = 8, padT = 12, padB = 22;
  const vals = points.map((p) => p.count);
  const top = niceMax(vals);
  const x = (i: number) => padL + i * ((W - padL - padR) / Math.max(1, points.length - 1));
  const y = (v: number) => padT + (1 - v / top) * (H - padT - padB);
  const ticks = [0, top / 2, top];
  let line = "";
  points.forEach((p, i) => { line += `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(p.count).toFixed(1)} `; });
  const area = points.length
    ? `${line}L ${x(points.length - 1).toFixed(1)} ${y(0)} L ${x(0).toFixed(1)} ${y(0)} Z`
    : "";
  const lastCount = points.length ? points[points.length - 1].count : 0;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="auto" role="img" aria-label="Trend over time" style={{ display: "block" }}>
      {ticks.map((t, ti) => (
        <g key={ti}>
          <line x1={padL} y1={y(t)} x2={W - padR} y2={y(t)} stroke="var(--line)" strokeWidth="1" strokeDasharray={ti === 1 ? "3 3" : undefined} />
          <text x={padL - 6} y={y(t) + 3} textAnchor="end" fontSize="10" fill="var(--muted)" fontFamily="var(--font-mono), monospace">{fmt(Math.round(t))}</text>
        </g>
      ))}
      {area && <path d={area} fill={color} fillOpacity="0.12" />}
      <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {points.map((p, i) => (
        <g key={i}>
          {i === points.length - 1 && <circle cx={x(i)} cy={y(p.count)} r="3.4" fill={color} />}
          <rect x={x(i) - (W / points.length) / 2} y={padT} width={W / points.length} height={H - padT - padB} fill="transparent">
            <title>{`${p.label}: ${fmt(p.count)}${unit ? " " + unit : ""}`}</title>
          </rect>
        </g>
      ))}
      {points.map((p, i) => (i % 5 === 0 ? <text key={`l${i}`} x={x(i)} y={H - 5} textAnchor="middle" fontSize="9" fill="var(--muted)" fontFamily="var(--font-mono), monospace">{p.label}</text> : null))}
      {points.length > 0 && (
        <text x={W - padR} y={y(lastCount) - 6} textAnchor="end" fontSize="10" fontWeight={700} fill={color}>{fmt(lastCount)}</text>
      )}
    </svg>
  );
}

/* ── single-series count columns (discrete per-day volume) ──
   For counts that are genuinely per-day events (new signups, daily-active
   users) — bars, with a 2px surface gap, hover titles, and sparse date ticks. */
export function CountColumns({
  points,
  color = "var(--accent)",
  unit = "",
}: {
  points: CountPoint[];
  color?: string;
  unit?: string;
}) {
  const W = 720, H = 132, padB = 18;
  const max = niceMax(points.map((p) => p.count));
  const n = Math.max(1, points.length);
  const step = W / n;
  const bw = Math.min(30, step * 0.68);
  const usable = H - padB - 6;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="auto" role="img" aria-label="Daily counts" style={{ display: "block" }}>
      {points.map((p, i) => {
        const cx = i * step + step / 2;
        const bx = cx - bw / 2;
        const h = p.count > 0 ? Math.max(2, (p.count / max) * usable) : 3;
        const zero = p.count === 0;
        return (
          <g key={i}>
            <rect x={bx} y={H - padB - h} width={bw} height={h} rx={3} fill={zero ? "color-mix(in srgb, var(--ink) 9%, transparent)" : color} />
            <rect x={i * step} y={0} width={step} height={H - padB} fill="transparent">
              <title>{`${p.label}: ${fmt(p.count)}${unit ? " " + unit : ""}`}</title>
            </rect>
            {i % 5 === 0 ? <text x={cx} y={H - 5} textAnchor="middle" fontSize="9" fill="var(--muted)" fontFamily="var(--font-mono), monospace">{p.label}</text> : null}
          </g>
        );
      })}
    </svg>
  );
}

/* ── tiny KPI-tile sparkline (area), count-scaled, no axes ── */
export function MiniSpark({ values, color = "var(--accent)" }: { values: number[]; color?: string }) {
  const W = 120, H = 30, pad = 2;
  if (values.length === 0) return null;
  const max = Math.max(1, ...values);
  const x = (i: number) => pad + i * ((W - 2 * pad) / Math.max(1, values.length - 1));
  const y = (v: number) => H - pad - (v / max) * (H - 2 * pad);
  let d = "";
  values.forEach((v, i) => { d += `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)} `; });
  const area = `${d}L ${x(values.length - 1).toFixed(1)} ${H - pad} L ${x(0).toFixed(1)} ${H - pad} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="30" preserveAspectRatio="none" aria-hidden="true" style={{ display: "block" }}>
      <path d={area} fill={color} fillOpacity="0.14" />
      <path d={d} fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ── result-mix gauge: one horizontal correct/almost/missed bar ──
   The learning-health signal. Status trio is below the CVD separation floor, so
   it is NEVER colour-alone: 2px surface gaps split the segments and a labelled
   legend sits beneath — the same secondary encoding the /report hero uses. */
export function ResultMixBar({
  correct, partial, incorrect,
}: {
  correct: number;
  partial: number;
  incorrect: number;
}) {
  const total = correct + partial + incorrect;
  const parts = [
    ["correct", correct, "var(--good)", "Correct"],
    ["partial", partial, "var(--warn)", "Almost"],
    ["incorrect", incorrect, "var(--bad)", "Missed"],
  ] as const;
  return (
    <div>
      <div className="w-full rounded-full overflow-hidden flex" style={{ height: 14, background: "color-mix(in srgb, var(--ink) 6%, transparent)", gap: 2 }}>
        {total > 0 &&
          parts.map(([k, v, c]) =>
            v > 0 ? <div key={k} style={{ width: `${(v / total) * 100}%`, background: c }} title={`${v}`} /> : null,
          )}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs muted">
        {parts.map(([k, v, c, label]) => (
          <span key={k} className="inline-flex items-center gap-1">
            <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: c }} />
            {label} {v.toLocaleString()}
          </span>
        ))}
      </div>
    </div>
  );
}
