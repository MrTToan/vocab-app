"use client";

import { useState, useCallback, useEffect } from "react";
import Link from "next/link";
import type { WritingTask, ChartData } from "@/lib/writing/types";
import { revalidateWritingPrompts } from "@/lib/swr";

/*
 * Self-serve "Add a question" flow. Task 2 = paste the prompt text, save.
 * Task 1 = paste the prompt text + a chart image; the image is read ONCE by the
 * vision LLM into chart_data, shown here for the user to confirm/edit, then saved.
 * The image is downscaled and stored inline (data URL) — no filesystem writes.
 */

const MAX_W = 1200; // downscale wide charts to keep the stored image lean

async function fileToDownscaledDataUrl(file: Blob): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_W / bitmap.width);
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0, w, h);
  // PNG keeps chart text/axes crisp for both the reader and the LLM.
  return canvas.toDataURL("image/png");
}

export default function AddPrompt() {
  const [task, setTask] = useState<WritingTask>("task1");
  const [title, setTitle] = useState("");
  const [promptText, setPromptText] = useState("");
  const [image, setImage] = useState<string | null>(null);
  const [chartText, setChartText] = useState(""); // editable JSON of chart_data
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);

  const readChart = useCallback(async (dataUrl: string) => {
    setReading(true);
    setError(null);
    setChartText("");
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
      setError(
        "Couldn't auto-read the chart (the AI reader may be busy). No problem — click " +
          "“Re-read chart” to try again, or just Save now: it'll store the question and image, " +
          "and only skip the automatic figure-check.",
      );
    } finally {
      setReading(false);
    }
  }, []);

  const onImage = useCallback(
    async (blob: Blob | null | undefined) => {
      if (!blob || !blob.type.startsWith("image/")) return;
      setSavedId(null);
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

  // Paste an image from anywhere on the page (Ctrl/⌘V) — e.g. after copying a chart
  // in Google Docs. A div's onPaste only fires when it's focused, so we listen on the
  // whole document. Google Docs may put the image on the clipboard as a real image, OR
  // as HTML / a link — so we fall back to fetching the image URL when there's no blob.
  useEffect(() => {
    if (task !== "task1") return;
    function handlePaste(e: ClipboardEvent) {
      const cd = e.clipboardData;
      if (!cd) return;
      // Read everything synchronously — clipboardData is only valid during the event.
      const fromFiles = Array.from(cd.files).find((f) => f.type.startsWith("image/"));
      const item = Array.from(cd.items).find((i) => i.kind === "file" && i.type.startsWith("image/"));
      const file = fromFiles ?? item?.getAsFile() ?? null;
      const html = cd.getData("text/html") || "";
      const uri = (cd.getData("text/uri-list") || cd.getData("text/plain") || "").trim();
      const imgSrc = /<img[^>]+src="([^"]+)"/i.exec(html)?.[1] || "";
      const urlLike = /^https?:\/\/\S+/i.test(uri) || /^data:image\//.test(uri) ? uri : "";
      const candidateUrl = imgSrc || urlLike;

      if (!file && !candidateUrl) return; // plain-text paste — let it happen normally
      e.preventDefault();

      (async () => {
        if (file) return onImage(file);
        if (candidateUrl.startsWith("data:image/")) {
          return onImage(await fetch(candidateUrl).then((r) => r.blob()));
        }
        try {
          const blob = await fetch(candidateUrl, { mode: "cors" }).then((r) => r.blob());
          if (blob.type.startsWith("image/")) return onImage(blob);
        } catch {
          /* fall through to guidance below */
        }
        setError(
          "That copy didn't include the actual image (Google Docs often copies just a link). " +
            "Easiest fix: screenshot the chart and paste that, or download the image and click the box to upload.",
        );
      })();
    }
    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, [task, onImage]);

  async function save() {
    setError(null);
    let chart_data: ChartData | null = null;
    if (task === "task1" && chartText.trim()) {
      try {
        chart_data = JSON.parse(chartText);
      } catch {
        setError("The chart data isn't valid JSON — fix it or clear the box to save without it.");
        return;
      }
    }
    setSaving(true);
    try {
      const res = await fetch("/api/writing/prompts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task_type: task,
          title: title.trim() || undefined,
          prompt_text: promptText,
          image: task === "task1" ? image : null,
          chart_data,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed.");
      setSavedId(data.prompt.id);
      revalidateWritingPrompts(task); // the practice page's cached list is now stale
      // reset for the next one
      setTitle("");
      setPromptText("");
      setImage(null);
      setChartText("");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  const canSave = promptText.trim().length >= 10 && !saving && !reading;

  return (
    <div className="space-y-4">
      {/* Task toggle — a segmented control whose ACTIVE option is clearly filled.
          Previously this used `chip btn-primary`, but `.chip` is defined after
          `.btn-primary` in globals.css, so its background won the cascade and the
          selected task looked identical to the unselected one — Task 2 essays were
          silently saved to Task 1. Inline styles here make the choice unambiguous. */}
      <div>
        <span className="text-sm muted block mb-1">Which task is this?</span>
        <div className="flex gap-2" role="group" aria-label="Task type">
          {(["task1", "task2"] as WritingTask[]).map((t) => {
            const on = task === t;
            return (
              <button
                key={t}
                type="button"
                aria-pressed={on}
                className="px-3.5 py-1.5 rounded-full text-sm font-semibold border transition-colors"
                style={
                  on
                    ? {
                        background: "var(--accent)",
                        borderColor: "var(--accent)",
                        color: "var(--accent-ink)",
                      }
                    : {
                        background: "transparent",
                        borderColor: "var(--line)",
                        color: "var(--muted)",
                        cursor: "pointer",
                      }
                }
                onClick={() => {
                  setTask(t);
                  setSavedId(null);
                }}
              >
                {t === "task1" ? "Task 1 (chart)" : "Task 2 (essay)"}
              </button>
            );
          })}
        </div>
      </div>

      <div className="card p-5 space-y-4">
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
            placeholder={
              task === "task1"
                ? "Paste the Task 1 question (e.g. “The chart below shows…”)."
                : "Paste the Task 2 essay prompt."
            }
            value={promptText}
            onChange={(e) => setPromptText(e.target.value)}
          />
        </label>

        {task === "task1" && (
          <div className="space-y-2">
            <span className="text-sm muted">Chart / diagram image</span>
            <label
              className="card p-6 text-center block cursor-pointer"
              style={{ borderStyle: "dashed" }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                onImage(e.dataTransfer.files?.[0]);
              }}
            >
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => onImage(e.target.files?.[0])}
              />
              <div className="font-semibold text-base mb-1">
                Press <kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>V</kbd> to paste the chart
              </div>
              <span className="muted text-sm block">
                …or click here to choose a file, or drag &amp; drop one.
              </span>
            </label>
            <details className="text-xs muted">
              <summary className="cursor-pointer">How do I get the chart out of Google Docs?</summary>
              <div className="mt-1 space-y-1">
                <p>
                  <b>Most reliable — screenshot it:</b> use your screenshot tool to copy the chart to the
                  clipboard, then press <b>Ctrl/⌘V</b> here.
                </p>
                <p>
                  <b>Or from the Doc:</b> right-click the chart → <b>Copy</b>, come back here, and press
                  <b> Ctrl/⌘V</b>. If nothing appears, Docs only copied a link — use the screenshot method
                  instead.
                </p>
              </div>
            </details>

            {image && (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={image}
                alt="chart preview"
                className="rounded-lg border max-w-full"
                style={{ borderColor: "var(--line)" }}
              />
            )}

            {image && (
              <div className="block">
                <span className="text-sm muted">
                  {reading
                    ? "🔍 Reading the chart with AI — this takes a few seconds, please wait…"
                    : chartText
                      ? "✓ Chart read. Check the numbers below, fix anything wrong, then Save."
                      : "Chart numbers (optional — the auto-read didn't fill these in)"}
                </span>
                {(reading || chartText) && (
                  <textarea
                    className="input mt-1 min-h-[220px] font-mono text-xs leading-5"
                    value={reading ? "Reading…" : chartText}
                    onChange={(e) => setChartText(e.target.value)}
                    disabled={reading}
                  />
                )}
                {!reading && (
                  <button className="btn mt-2" onClick={() => readChart(image)}>
                    {chartText ? "Re-read chart" : "Try reading the chart again"}
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {error && (
          <p className="text-sm" style={{ color: "var(--warn)" }}>
            {error}
          </p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          {savedId ? (
            <span className="text-sm" style={{ color: "var(--accent)" }}>
              Saved ✓ It&apos;s now in{" "}
              <Link href={`/writing/${task}`} className="underline">
                {task === "task1" ? "Task 1" : "Task 2"}
              </Link>
              . Add another below.
            </span>
          ) : (
            <span className="text-sm muted">
              {task === "task1"
                ? "Question + chart → saved to your Task 1 bank."
                : "Question → saved to your Task 2 bank."}
            </span>
          )}
          <button className="btn btn-primary" onClick={save} disabled={!canSave}>
            {saving
              ? "Saving…"
              : `Save to ${task === "task1" ? "Task 1" : "Task 2"}`}
          </button>
        </div>
      </div>
    </div>
  );
}
