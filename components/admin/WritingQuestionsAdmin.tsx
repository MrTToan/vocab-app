"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { jsonFetch } from "@/lib/ui";
import type { WritingPromptSummary, WritingTask, ChartData } from "@/lib/writing/types";
import { WRITING_TASKS } from "@/lib/writing/types";

/*
 * Owner-only "Writing Questions" management subtab. ONE combined list of Task 1
 * and Task 2 questions with search + task/visibility filters, plus add / edit /
 * delete / publish. The server routes are the real authorization boundary
 * (withOwner on POST/PATCH/DELETE); this UI only ever renders for the owner.
 *
 *   list   GET  /api/admin/writing-prompts       (every prompt, both tasks)
 *   add    POST /api/writing/prompts             (owner-only)
 *   edit   PATCH/DELETE /api/writing/prompts/:id (owner-only)
 *   image  GET  /api/writing/prompts/:id/image   (lazy chart bytes)
 */

const MAX_W = 1200; // downscale wide charts to keep the stored image lean
const JPEG_QUALITY = 0.85; // charts stay crisp; JPEG is far lighter than PNG

async function fileToDownscaledDataUrl(file: Blob): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_W / bitmap.width);
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  // JPEG has no alpha — flatten onto white first so transparent PNGs don't turn
  // black. Then encode JPEG: a chart stores ~5–8x smaller than PNG at q0.85 with
  // text/axes still crisp (the inline data URL lives in the DB — keep it lean).
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  return canvas.toDataURL("image/jpeg", JPEG_QUALITY);
}

type TaskFilter = "all" | WritingTask;
type VisFilter = "all" | "public" | "private";

export default function WritingQuestionsAdmin() {
  const [prompts, setPrompts] = useState<WritingPromptSummary[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [taskFilter, setTaskFilter] = useState<TaskFilter>("all");
  const [visFilter, setVisFilter] = useState<VisFilter>("all");
  const [editing, setEditing] = useState<WritingPromptSummary | "new" | null>(null);
  const [armedDelete, setArmedDelete] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const { prompts } = await jsonFetch<{ prompts: WritingPromptSummary[] }>("/api/admin/writing-prompts");
      setPrompts(prompts);
    } catch (e) {
      setErr((e as Error).message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (prompts ?? []).filter((p) => {
      if (taskFilter !== "all" && p.task_type !== taskFilter) return false;
      if (visFilter !== "all" && p.visibility !== visFilter) return false;
      if (needle) {
        const hay = `${p.title}\n${p.prompt_text}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [prompts, q, taskFilter, visFilter]);

  const counts = useMemo(() => {
    const all = prompts ?? [];
    return {
      total: all.length,
      task1: all.filter((p) => p.task_type === "task1").length,
      task2: all.filter((p) => p.task_type === "task2").length,
      published: all.filter((p) => p.visibility === "public").length,
      drafts: all.filter((p) => p.visibility !== "public").length,
    };
  }, [prompts]);

  async function togglePublish(p: WritingPromptSummary) {
    setBusyId(p.id);
    setErr(null);
    const visibility = p.visibility === "public" ? "private" : "public";
    try {
      await jsonFetch(`/api/writing/prompts/${p.id}`, {
        method: "PATCH",
        body: JSON.stringify({ visibility }),
      });
      setPrompts((list) => (list ?? []).map((x) => (x.id === p.id ? { ...x, visibility } : x)));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function remove(id: string) {
    setBusyId(id);
    setErr(null);
    try {
      await jsonFetch(`/api/writing/prompts/${id}`, { method: "DELETE" });
      setPrompts((list) => (list ?? []).filter((x) => x.id !== id));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusyId(null);
      setArmedDelete(null);
    }
  }

  if (editing) {
    return (
      <PromptEditor
        initial={editing === "new" ? null : editing}
        onDone={async (changed) => {
          setEditing(null);
          if (changed) await load();
        }}
      />
    );
  }

  return (
    <div className="space-y-4">
      <section className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Writing Questions</h1>
          <p className="muted mt-1 text-sm">
            The admin-managed bank for Task 1 &amp; Task 2. Add, edit, publish or remove questions.
          </p>
        </div>
        <button className="btn btn-primary whitespace-nowrap" onClick={() => setEditing("new")}>
          ＋ Add question
        </button>
      </section>

      {/* counts */}
      <div className="grid grid-cols-3 md:grid-cols-5 gap-3">
        <Tile label="Total" value={counts.total} />
        <Tile label="Task 1" value={counts.task1} />
        <Tile label="Task 2" value={counts.task2} />
        <Tile label="Published" value={counts.published} accent="var(--good)" />
        <Tile label="Drafts" value={counts.drafts} accent="var(--warn)" />
      </div>

      {/* toolbar */}
      <div className="card p-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:flex-wrap">
        <input
          className="input flex-1 min-w-[12rem]"
          placeholder="Search title or question text…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <Segmented
          label="Task"
          value={taskFilter}
          onChange={(v) => setTaskFilter(v as TaskFilter)}
          options={[
            { v: "all", label: "All" },
            { v: "task1", label: "Task 1" },
            { v: "task2", label: "Task 2" },
          ]}
        />
        <Segmented
          label="State"
          value={visFilter}
          onChange={(v) => setVisFilter(v as VisFilter)}
          options={[
            { v: "all", label: "All" },
            { v: "public", label: "Published" },
            { v: "private", label: "Drafts" },
          ]}
        />
      </div>

      {err && (
        <div className="card p-3 text-sm" style={{ background: "var(--bad-soft)", borderColor: "var(--bad)", color: "var(--bad)" }}>
          {err}
        </div>
      )}

      {prompts === null ? (
        <p className="muted">Loading questions…</p>
      ) : filtered.length === 0 ? (
        <div className="card p-6 text-center muted">
          {(prompts.length === 0)
            ? "No writing questions yet. Add the first one."
            : "No questions match these filters."}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((p) => {
            const isDraft = p.visibility !== "public";
            const busy = busyId === p.id;
            return (
              <div key={p.id} className="card p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="chip">{p.task_type === "task1" ? "Task 1" : "Task 2"}</span>
                      <span
                        className="chip"
                        style={
                          isDraft
                            ? { background: "var(--warn-soft)", color: "var(--warn)" }
                            : { background: "var(--good-soft)", color: "var(--good)" }
                        }
                      >
                        {isDraft ? "Draft" : "Published"}
                      </span>
                      {p.has_image && <span className="chip">🖼 chart</span>}
                    </div>
                    <div className="font-semibold mt-1.5 leading-snug">{p.title || "Untitled"}</div>
                    <p className="muted text-sm mt-0.5 line-clamp-2">{p.prompt_text}</p>
                  </div>
                  <div className="flex flex-wrap gap-1.5 shrink-0">
                    <button className="btn text-xs !min-h-0 !px-2 !py-1" onClick={() => setEditing(p)} disabled={busy}>
                      Edit
                    </button>
                    <button
                      className="btn text-xs !min-h-0 !px-2 !py-1"
                      onClick={() => togglePublish(p)}
                      disabled={busy}
                      title={isDraft ? "Make visible to learners" : "Hide from learners"}
                    >
                      {isDraft ? "Publish" : "Unpublish"}
                    </button>
                    <button
                      className="btn text-xs !min-h-0 !px-2 !py-1"
                      style={armedDelete === p.id ? { borderColor: "var(--bad)", color: "var(--bad)" } : undefined}
                      disabled={busy}
                      onClick={() => {
                        if (armedDelete === p.id) remove(p.id);
                        else setArmedDelete(p.id);
                      }}
                      onBlur={() => setArmedDelete((a) => (a === p.id ? null : a))}
                      title="Delete this question (past learner feedback is kept)"
                    >
                      {armedDelete === p.id ? "Confirm delete" : "Delete"}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ── the add / edit form (shared) ── */

function PromptEditor({
  initial,
  onDone,
}: {
  initial: WritingPromptSummary | null;
  onDone: (changed: boolean) => void | Promise<void>;
}) {
  const isEdit = !!initial;
  const [task, setTask] = useState<WritingTask>(initial?.task_type ?? "task1");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [promptText, setPromptText] = useState(initial?.prompt_text ?? "");
  const [modelAnswer, setModelAnswer] = useState(initial?.model_answer ?? "");
  const [visibility, setVisibility] = useState<"public" | "private">(
    initial ? (initial.visibility === "public" ? "public" : "private") : "public",
  );
  const [chartText, setChartText] = useState(
    initial?.chart_data ? JSON.stringify(initial.chart_data, null, 2) : "",
  );
  // image: null = keep existing (edit) / none (new); string = new data URL; "remove" = clear
  const [image, setImage] = useState<string | "remove" | null>(null);
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const existingImage = isEdit && initial!.has_image;
  const showImage = task === "task1";

  const readChart = useCallback(async (dataUrl: string) => {
    setReading(true);
    setError(null);
    try {
      const res = await fetch("/api/writing/extract-chart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: dataUrl }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not read the chart.");
      setChartText(JSON.stringify(data.chart_data, null, 2));
    } catch {
      setError("Couldn't auto-read the chart — you can enter the numbers by hand or save without them.");
    } finally {
      setReading(false);
    }
  }, []);

  const onImage = useCallback(
    async (blob: Blob | null | undefined) => {
      if (!blob || !blob.type.startsWith("image/")) return;
      setError(null);
      try {
        const dataUrl = await fileToDownscaledDataUrl(blob);
        setImage(dataUrl);
        await readChart(dataUrl);
      } catch {
        setError("That file didn't look like a readable image. Try a PNG/JPG screenshot.");
      }
    },
    [readChart],
  );

  async function save() {
    setError(null);
    const text = promptText.trim();
    if (text.length < 10) {
      setError("Please enter the question text (at least 10 characters).");
      return;
    }
    let chart_data: ChartData | null = null;
    if (task === "task1" && chartText.trim()) {
      try {
        chart_data = JSON.parse(chartText);
      } catch {
        setError("The chart data isn't valid JSON — fix it or clear the box.");
        return;
      }
    }
    setSaving(true);
    try {
      if (isEdit) {
        const body: Record<string, unknown> = {
          task_type: task,
          title: title.trim() || undefined,
          prompt_text: text,
          model_answer: modelAnswer.trim() ? modelAnswer.trim() : null,
          visibility,
        };
        // chart_data only meaningful for task1; clear it when switching to task2
        body.chart_data = task === "task1" ? chart_data : null;
        if (image === "remove") body.image = null;
        else if (typeof image === "string") body.image = image;
        // else: leave the stored image untouched (omit the field)
        if (task !== "task1" && existingImage && image === null) body.image = null;
        await jsonFetch(`/api/writing/prompts/${initial!.id}`, { method: "PATCH", body: JSON.stringify(body) });
      } else {
        await jsonFetch(`/api/writing/prompts`, {
          method: "POST",
          body: JSON.stringify({
            task_type: task,
            title: title.trim() || undefined,
            prompt_text: text,
            model_answer: modelAnswer.trim() ? modelAnswer.trim() : null,
            image: task === "task1" && typeof image === "string" ? image : null,
            chart_data: task === "task1" ? chart_data : null,
            visibility,
          }),
        });
      }
      await onDone(true);
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-extrabold tracking-tight">
          {isEdit ? "Edit question" : "Add question"}
        </h1>
        <button className="btn" onClick={() => onDone(false)} disabled={saving}>
          ← Back to list
        </button>
      </div>

      <div className="card p-5 space-y-4">
        {/* task toggle */}
        <div>
          <span className="text-sm muted block mb-1">Which task is this?</span>
          <div className="flex gap-2" role="group" aria-label="Task type">
            {WRITING_TASKS.map((t) => {
              const on = task === t;
              return (
                <button
                  key={t}
                  type="button"
                  aria-pressed={on}
                  className="px-3.5 py-1.5 rounded-full text-sm font-semibold border transition-colors"
                  style={
                    on
                      ? { background: "var(--accent)", borderColor: "var(--accent)", color: "var(--accent-ink)" }
                      : { background: "transparent", borderColor: "var(--line)", color: "var(--muted)", cursor: "pointer" }
                  }
                  onClick={() => setTask(t)}
                >
                  {t === "task1" ? "Task 1 (chart)" : "Task 2 (essay)"}
                </button>
              );
            })}
          </div>
        </div>

        {/* publish state */}
        <div>
          <span className="text-sm muted block mb-1">Visibility</span>
          <div className="flex gap-2" role="group" aria-label="Visibility">
            {(["public", "private"] as const).map((v) => {
              const on = visibility === v;
              return (
                <button
                  key={v}
                  type="button"
                  aria-pressed={on}
                  className="px-3.5 py-1.5 rounded-full text-sm font-semibold border transition-colors"
                  style={
                    on
                      ? { background: "var(--accent)", borderColor: "var(--accent)", color: "var(--accent-ink)" }
                      : { background: "transparent", borderColor: "var(--line)", color: "var(--muted)", cursor: "pointer" }
                  }
                  onClick={() => setVisibility(v)}
                >
                  {v === "public" ? "Published" : "Draft (hidden)"}
                </button>
              );
            })}
          </div>
        </div>

        <label className="block">
          <span className="text-sm muted">Title (optional)</span>
          <input
            className="input mt-1"
            placeholder="Auto-generated from the question if left blank"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>

        <label className="block">
          <span className="text-sm muted">Question text</span>
          <textarea
            className="input mt-1 min-h-[120px] leading-7"
            placeholder={task === "task1" ? "Paste the Task 1 question…" : "Paste the Task 2 essay prompt…"}
            value={promptText}
            onChange={(e) => setPromptText(e.target.value)}
          />
        </label>

        <label className="block">
          <span className="text-sm muted">Model / sample answer (optional)</span>
          <textarea
            className="input mt-1 min-h-[100px] leading-7"
            placeholder="A model answer or notes for graders (not shown to learners)."
            value={modelAnswer}
            onChange={(e) => setModelAnswer(e.target.value)}
          />
        </label>

        {showImage && (
          <div className="space-y-2">
            <span className="text-sm muted">Chart / diagram image</span>

            {existingImage && image === null && (
              <div className="space-y-1">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/writing/prompts/${initial!.id}/image`}
                  alt="current chart"
                  className="rounded-lg border max-w-full"
                  style={{ borderColor: "var(--line)" }}
                />
                <button className="btn text-xs !min-h-0 !px-2 !py-1" onClick={() => setImage("remove")}>
                  Remove image
                </button>
              </div>
            )}

            {typeof image === "string" && (
              <div className="space-y-1">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={image} alt="new chart" className="rounded-lg border max-w-full" style={{ borderColor: "var(--line)" }} />
                <button className="btn text-xs !min-h-0 !px-2 !py-1" onClick={() => setImage(existingImage ? null : "remove")}>
                  {existingImage ? "Keep current image" : "Clear"}
                </button>
              </div>
            )}

            {image === "remove" && (
              <div className="text-sm muted flex items-center gap-2">
                Image will be removed.
                <button className="btn text-xs !min-h-0 !px-2 !py-1" onClick={() => setImage(null)}>Undo</button>
              </div>
            )}

            <label
              className="card p-4 text-center block cursor-pointer"
              style={{ borderStyle: "dashed" }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                onImage(e.dataTransfer.files?.[0]);
              }}
            >
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => onImage(e.target.files?.[0])}
              />
              <span className="muted text-sm">
                Click, drag &amp; drop, or paste to {existingImage ? "replace the chart" : "add a chart"} image.
              </span>
            </label>

            {(reading || chartText) && (
              <label className="block">
                <span className="text-sm muted">
                  {reading ? "🔍 Reading the chart…" : "Chart numbers (ground truth for scoring)"}
                </span>
                <textarea
                  className="input mt-1 min-h-[160px] font-mono text-xs leading-5"
                  value={reading ? "Reading…" : chartText}
                  onChange={(e) => setChartText(e.target.value)}
                  disabled={reading}
                />
              </label>
            )}
            {typeof image === "string" && !reading && (
              <button className="btn text-xs !min-h-0 !px-2 !py-1" onClick={() => readChart(image)}>
                {chartText ? "Re-read chart" : "Read chart with AI"}
              </button>
            )}
          </div>
        )}

        {error && (
          <p className="text-sm" style={{ color: "var(--warn)" }}>
            {error}
          </p>
        )}

        <div className="flex items-center justify-end gap-2">
          <button className="btn" onClick={() => onDone(false)} disabled={saving}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={save} disabled={saving || reading}>
            {saving ? "Saving…" : isEdit ? "Save changes" : "Create question"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── small shared bits (match /admin visual language) ── */

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

function Segmented({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { v: string; label: string }[];
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs muted font-semibold">{label}</span>
      <div className="flex gap-1" role="group" aria-label={label}>
        {options.map((o) => {
          const on = value === o.v;
          return (
            <button
              key={o.v}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(o.v)}
              className="px-2.5 py-1 rounded-full text-xs font-semibold border transition-colors"
              style={
                on
                  ? { background: "var(--accent)", borderColor: "var(--accent)", color: "var(--accent-ink)" }
                  : { background: "transparent", borderColor: "var(--line)", color: "var(--muted)", cursor: "pointer" }
              }
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
