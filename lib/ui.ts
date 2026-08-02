import type { Result, Stage, Word } from "./types";

export const STAGE_ORDER: Stage[] = [
  "new",
  "recognition",
  "recall",
  "production",
  "known",
];

export const STAGE_LABEL: Record<Stage, string> = {
  new: "New",
  recognition: "Recognition",
  recall: "Recall",
  production: "Production",
  known: "Known",
};

export const STAGE_VAR: Record<Stage, string> = {
  new: "var(--muted)",
  recognition: "var(--warn)",
  recall: "var(--accent)",
  production: "var(--accent)",
  known: "var(--good)",
};

export function recentAccuracy(w: Pick<Word, "recent_results">): number {
  const r = w.recent_results;
  if (!r?.length) return 0;
  const sum = r.reduce(
    (a, x) => a + (x === "correct" ? 1 : x === "partial" ? 0.5 : 0),
    0,
  );
  return sum / r.length;
}

export function isWeak(w: Word): boolean {
  return (
    w.recent_results.length > 0 &&
    (recentAccuracy(w) < 0.6 ||
      w.recent_results[w.recent_results.length - 1] === "incorrect")
  );
}

export const RESULT_VAR: Record<Result, string> = {
  correct: "var(--good)",
  partial: "var(--warn)",
  incorrect: "var(--bad)",
};

export async function jsonFetch<T>(
  url: string,
  opts?: RequestInit,
): Promise<T> {
  const res = await fetch(url, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts?.headers ?? {}) },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);
  return data as T;
}
