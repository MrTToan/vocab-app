"use client";

import { useEffect, useRef, useState } from "react";
import { jsonFetch } from "@/lib/ui";
import {
  patchWritingPromptsCache,
  revalidateWritingPrompts,
  useConfig,
  useWritingPrompts,
} from "@/lib/swr";
import { MIN_WORDS, REC_MINUTES, type WritingPromptSummary, type WritingSubmission, type WritingTask } from "@/lib/writing/types";
import { countWords } from "@/lib/writing/grade";
import { pickInitialId } from "@/lib/writing/deeplink";
import Feedback, { bandColor } from "./Feedback";

type PromptStats = { attempts: number; bestBand: number; lastBand: number; lastAt: number } | null;
type PromptWithStats = WritingPromptSummary & { stats: PromptStats; can_edit: boolean };

/** Current `?q=` value, or null (SSR-safe). */
function readQ(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("q");
}

/** Reflect the selected question in the URL (`?q=<id>`) without navigating, so
 *  the address bar is always a copyable deep link to it. */
function syncQ(id: string): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.searchParams.set("q", id);
  window.history.replaceState(null, "", url);
}

/**
 * Writing workspace: pick a question from the left pane (with your past scores),
 * write your response on the right, submit for LLM feedback, or review your last
 * attempt without redoing it. Deliberate practice — no random surprise prompts.
 */
export default function WritingPractice({ task }: { task: WritingTask }) {
  // Shared SWR layer: the question list and /api/config are cached + deduped
  // (previously refetched imperatively on every mount).
  const { data: promptsData, error: promptsError } =
    useWritingPrompts<PromptWithStats>(task);
  const { data: config } = useConfig();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<WritingSubmission | null>(null); // fresh submission
  const [review, setReview] = useState<WritingSubmission | null>(null); // loaded past feedback
  const [view, setView] = useState<"write" | "result" | "review">("write");
  const [loadingReview, setLoadingReview] = useState(false);
  const [error, setError] = useState("");
  const hasLLM = config ? !!config.hasLLM : true;
  const isOwner = !!config?.owner; // gates the setup hint + publish toggle
  // null = still loading (matches the old imperative-load states).
  const prompts: PromptWithStats[] | null =
    promptsData?.prompts ?? (promptsError ? [] : null);

  const min = MIN_WORDS[task];
  const recMinutes = REC_MINUTES[task];
  const words = countWords(text);
  const selected = prompts?.find((p) => p.id === selectedId) ?? null;

  // Default the selection once the list arrives: honour a `?q=<id>` deep link
  // (a copyable link to a specific question), else fall back to the first.
  useEffect(() => {
    if (!promptsData) return;
    setSelectedId((prev) => prev ?? pickInitialId(promptsData.prompts, readQ()));
  }, [promptsData]);

  function pick(id: string) {
    setSelectedId(id);
    setText("");
    setResult(null);
    setReview(null);
    setView("write");
    setError("");
    syncQ(id); // keep the address bar a shareable link to this question
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
      revalidateWritingPrompts(task); // refresh scores in the pane
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

  // Site owner: publish/unpublish a prompt into the shared bank.
  async function setVisibility(id: string, visibility: "public" | "private") {
    setError("");
    try {
      const { prompt } = await jsonFetch<{ prompt: WritingPromptSummary }>(`/api/writing/prompts/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ visibility }),
      });
      patchWritingPromptsCache<PromptWithStats>(task, (list) =>
        list.map((p) => (p.id === id ? { ...p, visibility: prompt.visibility } : p)),
      );
    } catch (e) {
      setError((e as Error)?.message ?? "Couldn't change visibility");
    }
  }

  // Author (or site owner): remove a prompt. Past feedback on it is kept.
  async function remove(id: string) {
    setError("");
    try {
      await jsonFetch(`/api/writing/prompts/${id}`, { method: "DELETE" });
      const next = (prompts ?? []).filter((p) => p.id !== id);
      patchWritingPromptsCache<PromptWithStats>(task, (list) =>
        list.filter((p) => p.id !== id),
      );
      if (selectedId === id) {
        setSelectedId(next[0]?.id ?? null);
        setText("");
        setResult(null);
        setReview(null);
        setView("write");
      }
    } catch (e) {
      setError((e as Error)?.message ?? "Couldn't delete the question");
    }
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
        <QuestionList
          prompts={prompts}
          selectedId={selectedId}
          onPick={pick}
          isOwner={isOwner}
          onSetVisibility={setVisibility}
          onDelete={remove}
        />

        {/* ── practice / feedback ── */}
        <div className="min-w-0 space-y-4">
          {!hasLLM && (
            <div className="card p-3 text-sm" style={{ background: "var(--warn-soft)", borderColor: "var(--warn)" }}>
              {isOwner ? (
                <>
                  No LLM is configured, so scoring is off. Set up a provider in{" "}
                  <code>docs/SETUP-LLM-PROVIDERS.md</code>.
                </>
              ) : (
                <>AI scoring is off right now, so answers can&apos;t be graded yet.</>
              )}
            </div>
          )}

          {!selected ? (
            <div className="card p-6 text-center muted">Pick a question from the list to start.</div>
          ) : view === "result" && result ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
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
              <div className="flex flex-wrap items-center justify-between gap-2">
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
  isOwner,
  onSetVisibility,
  onDelete,
}: {
  prompts: PromptWithStats[];
  selectedId: string | null;
  onPick: (id: string) => void;
  isOwner: boolean;
  onSetVisibility: (id: string, visibility: "public" | "private") => void;
  onDelete: (id: string) => void;
}) {
  // Two-tap delete: the first tap arms, the second confirms (no modal dialogs).
  const [armed, setArmed] = useState<string | null>(null);
  return (
    <div className="no-print flex lg:flex-col gap-2 overflow-x-auto lg:overflow-x-visible lg:overflow-y-auto lg:max-h-[calc(100vh-8rem)] lg:sticky lg:top-24 pb-1 lg:pb-0 -mx-1 px-1">
      <div className="hidden lg:block text-xs font-bold muted uppercase tracking-wide px-1 pb-1">
        Questions · {prompts.length}
      </div>
      {prompts.map((p) => {
        const on = p.id === selectedId;
        const isPrivate = p.visibility !== "public";
        const manage = on && (isOwner || p.can_edit);
        return (
          <div
            key={p.id}
            className="shrink-0 lg:shrink card min-w-[13rem] lg:min-w-0 lg:w-full transition-colors"
            style={on ? { borderColor: "var(--accent)", background: "var(--accent-soft)" } : undefined}
          >
            <button onClick={() => onPick(p.id)} className="block w-full text-left p-3">
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
              {(p.stats || isPrivate) && (
                <div className="text-[11px] muted mt-1 flex flex-wrap gap-x-2">
                  {p.stats && (
                    <span>
                      {p.stats.attempts}× · last {p.stats.lastBand.toFixed(1)}
                    </span>
                  )}
                  {isPrivate && <span title="Only you can see this question">🔒 Private</span>}
                </div>
              )}
            </button>
            {manage && (
              <div className="flex flex-wrap gap-1.5 px-3 pb-3 -mt-1">
                {isOwner && (
                  <button
                    className="btn text-xs !min-h-0 !px-2 !py-1"
                    onClick={() => onSetVisibility(p.id, isPrivate ? "public" : "private")}
                    title={isPrivate ? "Make this question visible to everyone" : "Hide this question from other learners"}
                  >
                    {isPrivate ? "Publish" : "Unpublish"}
                  </button>
                )}
                {(isOwner || p.can_edit) && (
                  <button
                    className="btn text-xs !min-h-0 !px-2 !py-1"
                    style={armed === p.id ? { borderColor: "var(--bad)", color: "var(--bad)" } : undefined}
                    onClick={() => {
                      if (armed === p.id) {
                        setArmed(null);
                        onDelete(p.id);
                      } else setArmed(p.id);
                    }}
                    onBlur={() => setArmed((a) => (a === p.id ? null : a))}
                    title="Delete this question (your past feedback on it is kept)"
                  >
                    {armed === p.id ? "Confirm delete" : "Delete"}
                  </button>
                )}
              </div>
            )}
          </div>
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
        <div className="flex items-start justify-between gap-2 mb-1">
          {prompt.title ? <div className="font-bold">{prompt.title}</div> : <span />}
          <QuestionRef id={prompt.id} />
        </div>
        <p className="whitespace-pre-wrap">{prompt.prompt_text}</p>
        {prompt.has_image && (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={`/api/writing/prompts/${prompt.id}/image`}
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

/* ── the question's id + a one-tap copyable deep link (refer/share a question) ── */

function QuestionRef({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  async function copyLink() {
    const link = `${window.location.origin}${window.location.pathname}?q=${encodeURIComponent(id)}`;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked (insecure context / denied) — the id stays visible to copy by hand */
    }
  }
  return (
    <div className="no-print flex items-center gap-2 text-[11px] muted shrink-0">
      <span className="font-mono select-all truncate max-w-[9rem]" title={`Question id: ${id}`}>{id}</span>
      <button
        type="button"
        className="btn !min-h-0 !px-2 !py-1 text-[11px]"
        onClick={copyLink}
        title="Copy a shareable link to this question"
      >
        {copied ? "Copied ✓" : "🔗 Copy link"}
      </button>
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

const TIMER_POS_KEY = "lexi-writing-timer-pos";

function Timer({ minutes }: { minutes: number }) {
  const total = minutes * 60;
  const [left, setLeft] = useState(total);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setLeft((v) => v - 1), 1000);
    return () => clearInterval(id);
  }, [running]);

  // Draggable position. null = default bottom-right; otherwise a saved {left, top}.
  const boxRef = useRef<HTMLDivElement | null>(null);
  const dragOffset = useRef<{ dx: number; dy: number } | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useEffect(() => {
    try {
      const s = localStorage.getItem(TIMER_POS_KEY);
      if (s) setPos(JSON.parse(s));
    } catch {
      /* ignore */
    }
  }, []);

  // Keep it on-screen if the window is resized.
  useEffect(() => {
    if (!pos) return;
    const clamp = () => {
      const el = boxRef.current;
      if (!el) return;
      const w = el.offsetWidth, h = el.offsetHeight;
      setPos((p) =>
        p
          ? {
              left: Math.max(4, Math.min(p.left, window.innerWidth - w - 4)),
              top: Math.max(4, Math.min(p.top, window.innerHeight - h - 4)),
            }
          : p,
      );
    };
    window.addEventListener("resize", clamp);
    return () => window.removeEventListener("resize", clamp);
  }, [pos]);

  function onGripDown(e: React.PointerEvent) {
    const el = boxRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    dragOffset.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
    setPos({ left: rect.left, top: rect.top }); // switch from bottom-right to explicit coords
    e.currentTarget.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  }
  function onGripMove(e: React.PointerEvent) {
    const d = dragOffset.current;
    const el = boxRef.current;
    if (!d || !el) return;
    const w = el.offsetWidth, h = el.offsetHeight;
    const nextLeft = Math.max(4, Math.min(e.clientX - d.dx, window.innerWidth - w - 4));
    const nextTop = Math.max(4, Math.min(e.clientY - d.dy, window.innerHeight - h - 4));
    setPos({ left: nextLeft, top: nextTop });
  }
  function onGripUp() {
    if (!dragOffset.current) return;
    dragOffset.current = null;
    setPos((p) => {
      if (p) {
        try {
          localStorage.setItem(TIMER_POS_KEY, JSON.stringify(p));
        } catch {
          /* ignore */
        }
      }
      return p;
    });
  }

  const over = left <= 0;
  const low = left > 0 && left <= 120; // last 2 minutes
  const started = running || left !== total;
  const color = over ? "var(--bad)" : low ? "var(--warn)" : "var(--ink)";
  const compact = "text-sm !px-3 !py-1.5";

  return (
    <div
      ref={boxRef}
      className="no-print fixed z-40 card shadow-lg flex items-center gap-2 pr-3 py-2 max-w-[calc(100vw-1.5rem)]"
      style={{
        ...(pos ? { left: pos.left, top: pos.top } : { right: 16, bottom: 16 }),
        borderColor: over ? "var(--bad)" : low ? "var(--warn)" : "var(--line)",
      }}
    >
      <div
        onPointerDown={onGripDown}
        onPointerMove={onGripMove}
        onPointerUp={onGripUp}
        className="self-stretch flex items-center px-1.5 cursor-move select-none muted"
        style={{ touchAction: "none" }}
        title="Drag to move the timer"
        aria-label="Drag to move the timer"
      >
        ⠿
      </div>
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
