"use client";

import { useEffect, useRef, useState } from "react";
import {
  CRITERIA,
  CRITERION_LABEL,
  ERROR_LABEL,
  type Criterion,
  type WritingCorrection,
  type WritingSubmission,
  type WritingDiscussionMessage,
} from "@/lib/writing/types";
import { aggregateErrors } from "@/lib/writing/grade";
import CardDiscussion from "./CardDiscussion";

export function bandColor(b: number): string {
  return b >= 7 ? "var(--good)" : b >= 5.5 ? "var(--warn)" : "var(--bad)";
}

const CRITERION_COLOR: Record<Criterion, string> = {
  grammatical_range_accuracy: "var(--bad)",
  lexical_resource: "var(--warn)",
  coherence_cohesion: "var(--accent)",
  task_achievement: "var(--accent)",
};

/** corrections in reading order: by position in the essay, unlocated ones last. */
function orderedCorrections(cs: WritingCorrection[]) {
  return cs
    .map((c, i) => ({ c, i }))
    .sort((a, b) => (a.c.start ?? Number.MAX_SAFE_INTEGER) - (b.c.start ?? Number.MAX_SAFE_INTEGER));
}

export default function Feedback({ submission }: { submission: WritingSubmission }) {
  const s = submission;
  const errAgg = aggregateErrors(s.corrections);
  const ordered = orderedCorrections(s.corrections); // display order; index = "di"

  // hover state (transient) vs pinned (click). Effective focus = hover ?? pinned.
  const [hover, setHover] = useState<number | null>(null);
  const [pinned, setPinned] = useState<number | null>(null);
  const focused = hover ?? pinned;

  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Per-card discussion threads (keyed by card_key). Loaded once for the submission.
  const [threads, setThreads] = useState<Record<string, WritingDiscussionMessage[]>>({});
  const [busyCard, setBusyCard] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/writing/discuss?submissionId=${encodeURIComponent(s.id)}`)
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        const map: Record<string, WritingDiscussionMessage[]> = {};
        for (const m of (d.messages ?? []) as WritingDiscussionMessage[]) (map[m.card_key] ??= []).push(m);
        setThreads(map);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [s.id]);

  async function sendDiscuss(cardKey: string, text: string) {
    setBusyCard(cardKey);
    try {
      const res = await fetch("/api/writing/discuss", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ submissionId: s.id, cardKey, message: text }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Failed");
      setThreads((t) => ({ ...t, [cardKey]: d.messages }));
    } catch (e: any) {
      // Surface the failure inline as a synthetic assistant note (not persisted).
      setThreads((t) => ({
        ...t,
        [cardKey]: [
          ...(t[cardKey] ?? []),
          {
            id: `err-${Date.now()}`,
            submission_id: s.id,
            card_key: cardKey,
            role: "assistant",
            content: `⚠️ ${e.message}. Try again in a moment.`,
            seq: (t[cardKey]?.length ?? 0),
            created_at: Date.now(),
          },
        ],
      }));
    } finally {
      setBusyCard(null);
    }
  }

  const focusFromEssay = (di: number) => {
    setHover(di);
    cardRefs.current[di]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };
  const pinFromEssay = (di: number) => {
    setPinned((p) => (p === di ? null : di));
    cardRefs.current[di]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };

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
            <CardDiscussion
              messages={threads[`criterion:${c}`] ?? []}
              busy={busyCard === `criterion:${c}`}
              onSend={(t) => sendDiscuss(`criterion:${c}`, t)}
              accent={CRITERION_COLOR[c]}
            />
          </div>
        ))}
      </div>

      {/* Essay + comment panel (widened breakout so both columns breathe) */}
      <div>
        <h3 className="font-bold mb-2">Your writing, annotated</h3>
        <div>
          <div className="print-stack grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_20rem] gap-4 items-start">
            {/* essay */}
            <div className="card p-5 leading-8 text-[15px] whitespace-pre-wrap">
              <AnnotatedEssay
                text={s.text}
                ordered={ordered}
                focused={focused}
                onEnter={focusFromEssay}
                onLeave={() => setHover(null)}
                onClick={pinFromEssay}
              />
              {s.corrections.length === 0 && <span className="muted"> </span>}
            </div>

            {/* comment cards */}
            <div className="space-y-2 lg:sticky lg:top-24 lg:max-h-[calc(100vh-8rem)] lg:overflow-y-auto pr-0.5">
              {ordered.length === 0 ? (
                <div className="card p-4 text-sm muted">No corrections — clean writing!</div>
              ) : (
                ordered.map((o, di) => (
                  <CommentCard
                    key={o.i}
                    ref={(el) => {
                      cardRefs.current[di] = el;
                    }}
                    n={di + 1}
                    c={o.c}
                    active={focused === di}
                    pinned={pinned === di}
                    onEnter={() => setHover(di)}
                    onLeave={() => setHover(null)}
                    onClick={() => setPinned((p) => (p === di ? null : di))}
                    messages={threads[`correction:${o.i}`] ?? []}
                    busy={busyCard === `correction:${o.i}`}
                    onSend={(t) => sendDiscuss(`correction:${o.i}`, t)}
                  />
                ))
              )}
            </div>
          </div>
        </div>
        <p className="muted text-xs mt-2 no-print">Hover a highlight to jump to its note — or hover a note to find the phrase. Click to pin.</p>
      </div>

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
      {(s.priorities?.length > 0 || s.general_feedback) && (
        <div>
          <h3 className="font-bold mb-1">How to raise your band</h3>
          {s.general_feedback && <p className="text-sm muted mb-3">{s.general_feedback}</p>}
          <div className="space-y-3">
            {(s.priorities ?? []).map((p, i) => (
              <div key={i} className="card p-4">
                <div className="flex items-center gap-2 mb-2">
                  <span
                    className="inline-flex items-center justify-center w-5 h-5 rounded-full text-[11px] font-bold text-white shrink-0"
                    style={{ background: CRITERION_COLOR[p.criterion] }}
                  >
                    {i + 1}
                  </span>
                  <span className="font-bold">{p.title}</span>
                  <span className="chip ml-auto shrink-0">{CRITERION_LABEL[p.criterion]}</span>
                </div>
                <div className="space-y-1.5 text-sm">
                  <p>
                    <span className="font-semibold muted">Why · </span>
                    {p.why}
                  </p>
                  <p>
                    <span className="font-semibold" style={{ color: "var(--accent)" }}>How · </span>
                    {p.how}
                  </p>
                  {p.example && (
                    <div
                      className="mt-1 rounded-lg px-3 py-2 text-[13px]"
                      style={{ background: "var(--good-soft)", borderLeft: "3px solid var(--good)" }}
                    >
                      <span className="font-semibold" style={{ color: "var(--good)" }}>Try: </span>
                      {p.example}
                    </div>
                  )}
                </div>
                <CardDiscussion
                  messages={threads[`priority:${i}`] ?? []}
                  busy={busyCard === `priority:${i}`}
                  onSend={(t) => sendDiscuss(`priority:${i}`, t)}
                  accent={CRITERION_COLOR[p.criterion]}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── the essay with synced highlights ── */

function AnnotatedEssay({
  text,
  ordered,
  focused,
  onEnter,
  onLeave,
  onClick,
}: {
  text: string;
  ordered: { c: WritingCorrection; i: number }[];
  focused: number | null;
  onEnter: (di: number) => void;
  onLeave: () => void;
  onClick: (di: number) => void;
}) {
  // located corrections, in start order, carrying their display index (di)
  const located = ordered
    .map((o, di) => ({ ...o, di }))
    .filter((x) => x.c.start != null && x.c.end != null);

  const parts: React.ReactNode[] = [];
  let cursor = 0;
  for (const { c, di } of located) {
    const start = c.start!;
    const end = c.end!;
    if (start < cursor) continue; // defensive: skip overlaps
    if (start > cursor) parts.push(<span key={`t${cursor}`}>{text.slice(cursor, start)}</span>);
    const color = CRITERION_COLOR[c.criterion];
    const on = focused === di;
    parts.push(
      <mark
        key={`m${di}`}
        onMouseEnter={() => onEnter(di)}
        onMouseLeave={onLeave}
        onClick={() => onClick(di)}
        style={{
          background: on ? `color-mix(in srgb, ${color} 22%, transparent)` : "transparent",
          color: "inherit",
          borderBottom: `2px solid ${color}`,
          borderRadius: on ? 3 : 0,
          padding: on ? "0 2px" : 0,
          cursor: "pointer",
          transition: "background 0.12s ease",
        }}
      >
        {text.slice(start, end)}
        <sup className="text-[10px] font-bold" style={{ color }}>{di + 1}</sup>
      </mark>,
    );
    cursor = end;
  }
  if (cursor < text.length) parts.push(<span key="tend">{text.slice(cursor)}</span>);
  return <>{parts}</>;
}

/* ── a comment card ── */

const CommentCard = ({
  ref,
  n,
  c,
  active,
  pinned,
  onEnter,
  onLeave,
  onClick,
  messages,
  busy,
  onSend,
}: {
  ref: (el: HTMLDivElement | null) => void;
  n: number;
  c: WritingCorrection;
  active: boolean;
  pinned: boolean;
  onEnter: () => void;
  onLeave: () => void;
  onClick: () => void;
  messages: WritingDiscussionMessage[];
  busy: boolean;
  onSend: (text: string) => void | Promise<void>;
}) => {
  const color = CRITERION_COLOR[c.criterion];
  // Compact by default (one line: number + fix). Expands only when focused, so
  // the pane stays roughly as tall as the essay instead of a long, bulky stack.
  return (
    <div
      ref={ref}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onClick={onClick}
      className="card px-2.5 py-2 text-sm cursor-pointer transition-all"
      style={{
        borderColor: active ? color : "var(--line)",
        boxShadow: active ? `0 4px 16px color-mix(in srgb, ${color} 28%, transparent)` : "none",
      }}
    >
      <div className="flex items-center gap-2">
        <span
          className="inline-flex items-center justify-center w-5 h-5 rounded-full text-[11px] font-bold text-white shrink-0"
          style={{ background: color }}
        >
          {n}
        </span>
        <span className={"cc-orig " + (active ? "" : "truncate")}>
          <span style={{ textDecoration: "line-through", opacity: 0.55 }}>{c.original || "—"}</span>{" "}
          <span className="muted">→</span>{" "}
          <span className="font-semibold" style={{ color: "var(--good)" }}>{c.suggestion}</span>
        </span>
      </div>

      <div className="cc-detail mt-1.5 pl-7" data-open={active ? "true" : "false"}>
        <span className="chip">{ERROR_LABEL[c.error_type]}</span>
        {pinned && <span className="text-[10px] muted ml-2">📌 pinned</span>}
        {c.start == null && <span className="text-[10px] muted ml-2">not in text</span>}
        <p className="muted mt-1.5 text-[13px] leading-snug">{c.explanation}</p>
        <CardDiscussion messages={messages} busy={busy} onSend={onSend} accent={color} />
      </div>
    </div>
  );
};
