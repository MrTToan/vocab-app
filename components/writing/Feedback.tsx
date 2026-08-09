"use client";

import {
  CRITERIA,
  CRITERION_LABEL,
  ERROR_LABEL,
  type Criterion,
  type WritingCorrection,
  type WritingSubmission,
} from "@/lib/writing/types";
import { aggregateErrors } from "@/lib/writing/grade";

export function bandColor(b: number): string {
  return b >= 7 ? "var(--good)" : b >= 5.5 ? "var(--warn)" : "var(--bad)";
}

const CRITERION_COLOR: Record<Criterion, string> = {
  grammatical_range_accuracy: "var(--bad)",
  lexical_resource: "var(--warn)",
  coherence_cohesion: "var(--accent)",
  task_achievement: "var(--accent)",
};

export default function Feedback({ submission }: { submission: WritingSubmission }) {
  const s = submission;
  const errAgg = aggregateErrors(s.corrections);

  return (
    <div className="space-y-6">
      {/* Overall band */}
      <div className="card p-5 flex items-center justify-between gap-4">
        <div>
          <div className="text-sm muted font-semibold">Estimated overall band</div>
          <div className="text-5xl font-extrabold" style={{ color: bandColor(s.overall_band) }}>
            {s.overall_band.toFixed(1)}
          </div>
        </div>
        <div className="text-right text-sm muted">
          <div>{s.word_count} words</div>
          <div>{s.corrections.length} corrections</div>
        </div>
      </div>

      {/* Four criteria */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {CRITERIA.map((c) => (
          <div key={c} className="card p-4">
            <div className="flex items-center justify-between">
              <div className="font-bold text-sm">{CRITERION_LABEL[c]}</div>
              <div className="font-extrabold" style={{ color: bandColor(s.bands[c].band) }}>
                {s.bands[c].band.toFixed(1)}
              </div>
            </div>
            <p className="muted text-sm mt-1">{s.bands[c].comment}</p>
          </div>
        ))}
      </div>

      {/* Essay with inline corrections */}
      <div>
        <h3 className="font-bold mb-2">Your writing, annotated</h3>
        <div className="card p-4 leading-8 text-[15px] whitespace-pre-wrap">
          <InlineText text={s.text} corrections={s.corrections} />
        </div>
        <p className="muted text-xs mt-1">Hover a highlight to see the fix.</p>
      </div>

      {/* Corrections list */}
      {s.corrections.length > 0 && (
        <div>
          <h3 className="font-bold mb-2">Corrections</h3>
          <div className="space-y-2">
            {s.corrections.map((c, i) => (
              <CorrectionRow key={i} n={i + 1} c={c} />
            ))}
          </div>
        </div>
      )}

      {/* Error summary */}
      {errAgg.length > 0 && (
        <div>
          <h3 className="font-bold mb-2">Error types</h3>
          <div className="flex flex-wrap gap-2">
            {errAgg.map((e) => (
              <span key={e.error_type} className="chip">
                {ERROR_LABEL[e.error_type]} · {e.count}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Strengths + general feedback */}
      {s.strengths.length > 0 && (
        <div className="card p-4" style={{ background: "var(--good-soft)", borderColor: "var(--good)" }}>
          <div className="font-bold text-sm mb-1">What worked</div>
          <ul className="text-sm space-y-1">
            {s.strengths.map((st, i) => (
              <li key={i}>✓ {st}</li>
            ))}
          </ul>
        </div>
      )}
      {s.general_feedback && (
        <div className="card p-4">
          <div className="font-bold text-sm mb-1">Priority to improve</div>
          <p className="text-sm">{s.general_feedback}</p>
        </div>
      )}
    </div>
  );
}

function CorrectionRow({ n, c }: { n: number; c: WritingCorrection }) {
  return (
    <div className="card p-3 text-sm">
      <div className="flex items-center gap-2">
        <span
          className="inline-flex items-center justify-center w-5 h-5 rounded-full text-xs font-bold text-white shrink-0"
          style={{ background: CRITERION_COLOR[c.criterion] }}
        >
          {n}
        </span>
        <span className="chip">{ERROR_LABEL[c.error_type]}</span>
      </div>
      <div className="mt-2">
        <span style={{ textDecoration: "line-through", opacity: 0.6 }}>{c.original || "—"}</span>{" "}
        <span className="muted">→</span>{" "}
        <span className="font-semibold" style={{ color: "var(--good)" }}>{c.suggestion}</span>
      </div>
      <p className="muted mt-1">{c.explanation}</p>
    </div>
  );
}

/** Render the essay, wrapping located corrections in colored, numbered marks. */
function InlineText({ text, corrections }: { text: string; corrections: WritingCorrection[] }) {
  const located = corrections
    .map((c, i) => ({ c, i }))
    .filter((x) => x.c.start != null && x.c.end != null)
    .sort((a, b) => (a.c.start! - b.c.start!));

  const parts: React.ReactNode[] = [];
  let cursor = 0;
  for (const { c, i } of located) {
    const start = c.start!;
    const end = c.end!;
    if (start < cursor) continue; // defensive: skip any overlap
    if (start > cursor) parts.push(<span key={`t${cursor}`}>{text.slice(cursor, start)}</span>);
    parts.push(
      <mark
        key={`m${i}`}
        title={`${c.original} → ${c.suggestion} — ${c.explanation}`}
        style={{
          background: "transparent",
          color: "inherit",
          borderBottom: `2px solid ${CRITERION_COLOR[c.criterion]}`,
          cursor: "help",
        }}
      >
        {text.slice(start, end)}
        <sup className="text-[10px] font-bold" style={{ color: CRITERION_COLOR[c.criterion] }}>
          {i + 1}
        </sup>
      </mark>,
    );
    cursor = end;
  }
  if (cursor < text.length) parts.push(<span key="tend">{text.slice(cursor)}</span>);
  return <>{parts}</>;
}
