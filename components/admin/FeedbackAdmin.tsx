"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { jsonFetch } from "@/lib/ui";
import {
  FEEDBACK_CATEGORIES,
  type FeedbackCategory,
  type FeedbackEntry,
} from "@/lib/feedback/types";

/*
 * Admin "Feedback" subtab — a read-only list of every submission from the
 * in-app widget, newest first. Owner-only: the /api/feedback GET is withOwner
 * (403 otherwise), and the portal is only rendered for the owner. Mirrors the
 * WritingQuestionsAdmin fetch shape (local state + jsonFetch, not SWR).
 */

const CATEGORY_LABELS: Record<FeedbackCategory, string> = {
  bug: "Bug",
  idea: "Idea",
  other: "Other",
};

type CatFilter = "all" | FeedbackCategory;

function fmtDate(ms: number): string {
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return "";
  }
}

function Stars({ rating }: { rating: number | null }) {
  if (rating == null) return <span className="muted text-sm">—</span>;
  return (
    <span aria-label={`${rating} of 5`} title={`${rating}/5`} style={{ color: "var(--accent)" }}>
      {"★".repeat(rating)}
      <span style={{ color: "var(--line)" }}>{"★".repeat(5 - rating)}</span>
    </span>
  );
}

export default function FeedbackAdmin() {
  const [items, setItems] = useState<FeedbackEntry[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [catFilter, setCatFilter] = useState<CatFilter>("all");

  const load = useCallback(async () => {
    setErr(null);
    try {
      const { feedback } = await jsonFetch<{ feedback: FeedbackEntry[] }>("/api/feedback");
      setItems(feedback);
    } catch (e) {
      setErr((e as Error).message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(
    () => (items ?? []).filter((f) => catFilter === "all" || f.category === catFilter),
    [items, catFilter],
  );

  if (err) {
    return (
      <div className="card p-4 space-y-2">
        <p className="text-sm" role="alert">
          Couldn’t load feedback: {err}
        </p>
        <button className="btn" onClick={load}>
          Retry
        </button>
      </div>
    );
  }

  if (items === null) {
    return <p className="muted text-sm">Loading feedback…</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm font-bold">Filter</span>
        {(["all", ...FEEDBACK_CATEGORIES] as CatFilter[]).map((c) => {
          const on = catFilter === c;
          return (
            <button
              key={c}
              onClick={() => setCatFilter(c)}
              className="px-2.5 py-1 rounded-lg text-sm font-semibold border transition-colors"
              style={
                on
                  ? { borderColor: "var(--accent)", background: "var(--accent-soft)", color: "var(--accent)" }
                  : { borderColor: "var(--line)", color: "var(--muted)" }
              }
            >
              {c === "all" ? "All" : CATEGORY_LABELS[c]}
            </button>
          );
        })}
        <span className="muted text-sm ml-auto">
          {filtered.length} of {items.length}
        </span>
      </div>

      {filtered.length === 0 ? (
        <p className="muted text-sm">No feedback yet.</p>
      ) : (
        <ul className="space-y-3">
          {filtered.map((f) => (
            <li key={f.id} className="card p-4 space-y-2">
              <div className="flex items-center gap-2 flex-wrap text-sm">
                <span
                  className="px-2 py-0.5 rounded-md font-bold text-xs uppercase tracking-wide"
                  style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
                >
                  {CATEGORY_LABELS[f.category]}
                </span>
                <Stars rating={f.rating} />
                <span className="muted ml-auto">{fmtDate(f.created_at)}</span>
              </div>
              <p className="whitespace-pre-wrap break-words">{f.message}</p>
              <div className="muted text-xs flex items-center gap-2 flex-wrap">
                <span>{f.user_email || f.user_name || f.user_id || "unknown user"}</span>
                {f.page && (
                  <>
                    <span aria-hidden>·</span>
                    <span>from {f.page}</span>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
