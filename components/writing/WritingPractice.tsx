"use client";

import { useCallback, useEffect, useState } from "react";
import { jsonFetch } from "@/lib/ui";
import { MIN_WORDS, type WritingPrompt, type WritingSubmission, type WritingTask } from "@/lib/writing/types";
import { countWords } from "@/lib/writing/grade";
import Feedback from "./Feedback";

/**
 * The writing practice loop, shared by Task 1 and Task 2. Fetches a prompt,
 * takes the candidate's response, submits it for LLM scoring, and renders
 * structured feedback. Task 1 additionally shows the chart image.
 */
export default function WritingPractice({ task }: { task: WritingTask }) {
  const [prompt, setPrompt] = useState<WritingPrompt | null>(null);
  const [loadingPrompt, setLoadingPrompt] = useState(true);
  const [noBank, setNoBank] = useState(false);
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submission, setSubmission] = useState<WritingSubmission | null>(null);
  const [error, setError] = useState("");
  const [hasLLM, setHasLLM] = useState(true);

  const min = MIN_WORDS[task];
  const words = countWords(text);

  const loadPrompt = useCallback(async () => {
    setLoadingPrompt(true);
    setError("");
    setSubmission(null);
    setText("");
    try {
      const { prompt } = await jsonFetch<{ prompt: WritingPrompt | null }>(
        `/api/writing/prompts?task=${task}&pick=1`,
      );
      setPrompt(prompt);
      setNoBank(!prompt);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load a prompt");
    } finally {
      setLoadingPrompt(false);
    }
  }, [task]);

  useEffect(() => {
    jsonFetch<{ hasLLM: boolean }>("/api/config")
      .then((c) => setHasLLM(!!c.hasLLM))
      .catch(() => {});
    loadPrompt();
  }, [loadPrompt]);

  async function submit() {
    if (!prompt) return;
    setSubmitting(true);
    setError("");
    try {
      const { submission } = await jsonFetch<{ submission: WritingSubmission }>(
        "/api/writing/submit",
        { method: "POST", body: JSON.stringify({ promptId: prompt.id, text }) },
      );
      setSubmission(submission);
    } catch (e: any) {
      setError(e?.message ?? "Scoring failed");
    } finally {
      setSubmitting(false);
    }
  }

  if (loadingPrompt) return <p className="muted">Loading a prompt…</p>;

  if (noBank) {
    return (
      <div className="card p-5">
        <div className="font-bold">No prompts yet</div>
        <p className="muted text-sm mt-1">
          {task === "task1"
            ? "Ingest chart questions with the /ingest-writing-prompts skill to start practising Task 1."
            : "No Task 2 prompts in the bank yet. Seed some (scripts/seed-writing-prompts.mjs) or add via the ingest skill."}
        </p>
      </div>
    );
  }

  // Result view
  if (submission) {
    return (
      <div className="space-y-5">
        <Feedback submission={submission} />
        <div className="flex gap-2">
          <button className="btn btn-primary" onClick={loadPrompt}>Write another →</button>
        </div>
      </div>
    );
  }

  // Writing view
  const underMin = words > 0 && words < min;
  return (
    <div className="space-y-4">
      {!hasLLM && (
        <div className="card p-3 text-sm" style={{ background: "var(--warn-soft)", borderColor: "var(--warn)" }}>
          No LLM is configured, so scoring is off. Set up a provider in <code>docs/SETUP-LLM-PROVIDERS.md</code> to get feedback.
        </div>
      )}

      {prompt && (
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
      )}

      <textarea
        className="input min-h-[280px] font-[inherit] leading-7"
        placeholder={`Write your response here (at least ${min} words)…`}
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={submitting}
      />

      <div className="flex items-center justify-between gap-3">
        <div className="text-sm" style={{ color: underMin ? "var(--warn)" : "var(--muted)" }}>
          {words} / {min} words{underMin && " · under the minimum"}
        </div>
        <div className="flex items-center gap-2">
          <button className="btn" onClick={loadPrompt} disabled={submitting}>New prompt</button>
          <button
            className="btn btn-primary"
            onClick={submit}
            disabled={submitting || !hasLLM || words < 5}
          >
            {submitting ? "Scoring…" : "Submit for feedback"}
          </button>
        </div>
      </div>

      {error && (
        <div className="card p-3 text-sm" style={{ background: "var(--bad-soft)", borderColor: "var(--bad)", color: "var(--bad)" }}>
          {error}
        </div>
      )}
    </div>
  );
}
