"use client";

import { useCallback, useEffect, useState } from "react";
import { jsonFetch } from "@/lib/ui";
import { MIN_WORDS, REC_MINUTES, type WritingPrompt, type WritingSubmission, type WritingTask } from "@/lib/writing/types";
import { countWords } from "@/lib/writing/grade";
import Feedback, { bandColor } from "./Feedback";

type PromptStats = { attempts: number; bestBand: number; lastBand: number; lastAt: number } | null;
type PromptWithStats = WritingPrompt & { stats: PromptStats };

/**
 * Writing workspace: pick a question from the left pane (with your past scores),
 * write your response on the right, submit for LLM feedback, or review your last
 * attempt without redoing it. Deliberate practice — no random surprise prompts.
 */
export default function WritingPractice({ task }: { task: WritingTask }) {
  const [prompts, setPrompts] = useState<PromptWithStats[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<WritingSubmission | null>(null); // fresh submission
  const [review, setReview] = useState<WritingSubmission | null>(null); // loaded past feedback
  const [view, setView] = useState<"write" | "result" | "review">("write");
  const [loadingReview, setLoadingReview] = useState(false);
  const [error, setError] = useState("");
  const [hasLLM, setHasLLM] = useState(true);

  const min = MIN_WORDS[task];
  const recMinutes = REC_MINUTES[task];
  const words = countWords(text);
  const selected = prompts?.find((p) => p.id === selectedId) ?? null;

  const loadList = useCallback(async () => {
    try {
      const { prompts } = await jsonFetch<{ prompts: PromptWithStats[] }>(`/api/writing/prompts?task=${task}`);
      setPrompts(prompts);
      setSelectedId((prev) => prev ?? prompts[0]?.id ?? null);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load questions");
      setPrompts([]);
    }
  }, [task]);

  useEffect(() => {
    jsonFetch<{ hasLLM: boolean }>("/api/config").then((c) => setHasLLM(!!c.hasLLM)).catch(() => {});
    loadList();
  }, [loadList]);

  function pick(id: string) {
    setSelectedId(id);
    setText("");
    setResult(null);
    setReview(null);
    setView("write");
    setError("");
  }

  async function submit() {
    if (!selected) return;
    setSubmitting(true);
    setError("");
    try {
      const { submission } = await jsonFetch<{ submission: WritingSubmission }>("/api/writing/submit", {
        method: "POST",
        body: JSON.stringify({ promptId: selected.id, text }),
      });
      setResult(submission);
      setView("result");
      loadList(); // refresh scores in the pane
    } catch (e: any) {
      setError(e?.message ?? "Scoring failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function loadReview() {
    if (!selected) return;
    setLoadingReview(true);
    setError("");
    try {
      const { submission } = await jsonFetch<{ submission: WritingSubmission | null }>(
        `/api/writing/submission?promptId=${selected.id}`,
      );
      if (submission) {
        setReview(submission);
        setView("review");
      }
    } catch (e: any) {
      setError(e?.message ?? "Couldn't load your last feedback");
    } finally {
      setLoadingReview(false);
    }
  }

  function writeAgain() {
    setText("");
    setResult(null);
    setReview(null);
    setView("write");
  }

  if (prompts === null) return <p className="muted">Loading questions…</p>;

  if (prompts.length === 0) {
    return (
      <div className="card p-5">
        <div className="font-bold">No questions yet</div>
        <p className="muted text-sm mt-1">
          {task === "task1"
            ? "Index chart questions with the ingest-writing-prompts skill to start Task 1."
            : "No Task 2 questions yet. Add them to your Task 2 doc and run the ingest skill, or seed samples (scripts/seed-writing-prompts.mjs)."}
        </p>
      </div>
    );
  }

  return (
    <>
      {/* Floating exam clock — rendered outside the translated container below so
          `position: fixed` tracks the viewport (a CSS transform on an ancestor
          would otherwise anchor it to that ancestor). Keyed by question → resets. */}
      {selected && view === "write" && <Timer key={selected.id} minutes={recMinutes} />}

      <div className="print-linear lg:w-[80rem] lg:max-w-[94vw] lg:relative lg:left-1/2 lg:-translate-x-1/2">
      <div className="print-stack grid grid-cols-1 lg:grid-cols-[17rem_minmax(0,1fr)] gap-5 items-start">
        {/* ── question picker ── */}
        <QuestionList prompts={prompts} selectedId={selectedId} onPick={pick} />

        {/* ── practice / feedback ── */}
        <div className="min-w-0 space-y-4">
          {!hasLLM && (
            <div className="card p-3 text-sm" style={{ background: "var(--warn-soft)", borderColor: "var(--warn)" }}>
              No LLM is configured, so scoring is off. Set up a provider in <code>docs/SETUP-LLM-PROVIDERS.md</code>.
            </div>
          )}

          {!selected ? (
            <div className="card p-6 text-center muted">Pick a question from the list to start.</div>
          ) : view === "result" && result ? (
            <>
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-bold">{selected.title || "Feedback"}</h2>
                <div className="flex gap-2 no-print">
                  <button className="btn" onClick={() => window.print()}>⬇ Export PDF</button>
                  <button className="btn" onClick={writeAgain}>Write again</button>
                </div>
              </div>
              <Feedback submission={result} />
            </>
          ) : view === "review" && review ? (
            <>
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h2 className="font-bold">{selected.title || "Your last attempt"}</h2>
                  <p className="muted text-xs">Reviewed from {new Date(review.created_at).toLocaleDateString()} — not a new score.</p>
                </div>
                <div className="flex gap-2 no-print">
                  <button className="btn" onClick={() => window.print()}>⬇ Export PDF</button>
                  <button className="btn btn-primary" onClick={writeAgain}>Write again</button>
                </div>
              </div>
              <Feedback submission={review} />
            </>
          ) : (
            <PromptWriter
              prompt={selected}
              text={text}
              setText={setText}
              words={words}
              min={min}
              submitting={submitting}
              hasLLM={hasLLM}
              onSubmit={submit}
              onReview={loadReview}
              loadingReview={loadingReview}
            />
          )}

          {error && (
            <div className="card p-3 text-sm" style={{ background: "var(--bad-soft)", borderColor: "var(--bad)", color: "var(--bad)" }}>
              {error}
            </div>
          )}
        </div>
      </div>
      </div>
    </>
  );
}

/* ── left pane ── */

function QuestionList({
  prompts,
  selectedId,
  onPick,
}: {
  prompts: PromptWithStats[];
  selectedId: string | null;
  onPick: (id: string) => void;
}) {
  return (
    <div className="no-print flex lg:flex-col gap-2 overflow-x-auto lg:overflow-x-visible lg:overflow-y-auto lg:max-h-[calc(100vh-8rem)] lg:sticky lg:top-24 pb-1 lg:pb-0 -mx-1 px-1">
      <div className="hidden lg:block text-xs font-bold muted uppercase tracking-wide px-1 pb-1">
        Questions · {prompts.length}
      </div>
      {prompts.map((p) => {
        const on = p.id === selectedId;
        return (
          <button
            key={p.id}
            onClick={() => onPick(p.id)}
            className="shrink-0 lg:shrink text-left card p-3 min-w-[13rem] lg:min-w-0 lg:w-full transition-colors"
            style={on ? { borderColor: "var(--accent)", background: "var(--accent-soft)" } : undefined}
          >
            <div className="flex items-start justify-between gap-2">
              <span className="font-semibold text-sm leading-snug line-clamp-2">{p.title || p.prompt_text.slice(0, 60)}</span>
              {p.stats ? (
                <span
                  className="shrink-0 text-xs font-extrabold px-1.5 py-0.5 rounded-md text-white"
                  style={{ background: bandColor(p.stats.bestBand) }}
                >
                  {p.stats.bestBand.toFixed(1)}
                </span>
              ) : (
                <span className="shrink-0 chip">New</span>
              )}
            </div>
            {p.stats && (
              <div className="text-[11px] muted mt-1">
                {p.stats.attempts}× · last {p.stats.lastBand.toFixed(1)}
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ── the write view for a selected prompt ── */

function PromptWriter({
  prompt,
  text,
  setText,
  words,
  min,
  submitting,
  hasLLM,
  onSubmit,
  onReview,
  loadingReview,
}: {
  prompt: PromptWithStats;
  text: string;
  setText: (v: string) => void;
  words: number;
  min: number;
  submitting: boolean;
  hasLLM: boolean;
  onSubmit: () => void;
  onReview: () => void;
  loadingReview: boolean;
}) {
  const underMin = words > 0 && words < min;
  const done = prompt.stats;
  return (
    <div className="space-y-4">
      <div className="card p-5">
        {prompt.title && <div className="font-bold mb-1">{prompt.title}</div>}
        <p className="whitespace-pre-wrap">{prompt.prompt_text}</p>
        {prompt.image_path && (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={prompt.image_path}
            alt={prompt.title || "chart"}
            className="mt-4 rounded-lg border max-w-full"
            style={{ borderColor: "var(--line)" }}
          />
        )}
      </div>

      {done && (
        <div className="card p-3 text-sm flex flex-wrap items-center justify-between gap-2" style={{ background: "var(--accent-soft)", borderColor: "var(--accent)" }}>
          <span>
            You&apos;ve done this <b>{done.attempts}×</b> — best band{" "}
            <b style={{ color: bandColor(done.bestBand) }}>{done.bestBand.toFixed(1)}</b>, last {done.lastBand.toFixed(1)}.
          </span>
          <button className="btn" onClick={onReview} disabled={loadingReview}>
            {loadingReview ? "Loading…" : "View last feedback"}
          </button>
        </div>
      )}

      <textarea
        className="input min-h-[300px] font-[inherit] leading-7"
        placeholder={`Write your response here (at least ${min} words)…`}
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={submitting}
        // No browser spell-check/autocorrect while practising — exam-like, so
        // catching your own spelling is part of the test, not the browser's job.
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="off"
        autoComplete="off"
      />

      <div className="flex items-center justify-between gap-3">
        <div className="text-sm" style={{ color: underMin ? "var(--warn)" : "var(--muted)" }}>
          {words} / {min} words{underMin && " · under the minimum"}
        </div>
        <button className="btn btn-primary" onClick={onSubmit} disabled={submitting || !hasLLM || words < 5}>
          {submitting ? "Scoring…" : done ? "Submit new attempt" : "Submit for feedback"}
        </button>
      </div>
    </div>
  );
}

/* ── countdown clock: the exam-pacing recommendation (20 min T1 / 40 min T2) ── */

function fmtClock(sec: number): string {
  const a = Math.abs(sec);
  return `${Math.floor(a / 60)}:${String(a % 60).padStart(2, "0")}`;
}

/** A clock face whose hand sweeps as time runs down (fraction 1 → 0). */
function ClockIcon({ color, fraction }: { color: string; fraction: number }) {
  const f = Math.max(0, Math.min(1, fraction));
  const angle = (1 - f) * 2 * Math.PI; // 0 at top, clockwise as time passes
  const hx = 12 + 5 * Math.sin(angle);
  const hy = 12 - 5 * Math.cos(angle);
  return (
    <svg
      width="30"
      height="30"
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="9" />
      <line x1="12" y1="12" x2={hx.toFixed(2)} y2={hy.toFixed(2)} />
    </svg>
  );
}

function Timer({ minutes }: { minutes: number }) {
  const total = minutes * 60;
  const [left, setLeft] = useState(total);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setLeft((v) => v - 1), 1000);
    return () => clearInterval(id);
  }, [running]);

  const over = left <= 0;
  const low = left > 0 && left <= 120; // last 2 minutes
  const started = running || left !== total;
  const color = over ? "var(--bad)" : low ? "var(--warn)" : "var(--ink)";
  const compact = "text-sm !px-3 !py-1.5";

  return (
    <div
      className="no-print fixed bottom-4 right-4 z-40 card shadow-lg flex items-center gap-3 pl-3 pr-3 py-2"
      style={{ borderColor: over ? "var(--bad)" : low ? "var(--warn)" : "var(--line)" }}
    >
      <ClockIcon color={color} fraction={left / total} />
      <div className="flex flex-col leading-none">
        <span className="text-2xl font-extrabold tabular-nums" style={{ color }}>
          {over && "+"}
          {fmtClock(left)}
        </span>
        <span className="muted text-[11px] mt-1">
          {over ? `over ${minutes} min` : `of ${minutes} min`}
        </span>
      </div>
      <div className="flex flex-col gap-1.5">
        <button className={`btn ${compact}`} onClick={() => setRunning((r) => !r)}>
          {running ? "Pause" : started ? "Resume" : "Start"}
        </button>
        <button
          className={`btn ${compact}`}
          onClick={() => {
            setRunning(false);
            setLeft(total);
          }}
          disabled={!started}
        >
          Reset
        </button>
      </div>
    </div>
  );
}
