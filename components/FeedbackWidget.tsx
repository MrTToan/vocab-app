"use client";

import { useEffect, useRef, useState } from "react";
import { jsonFetch } from "@/lib/ui";
import { FEEDBACK_CATEGORIES, type FeedbackCategory } from "@/lib/feedback/types";

/*
 * The floating in-app "Feedback" button + form. Mounted once by the (app)
 * layout, so it rides along on every signed-in page (practice, library, writing,
 * report, …) but never the marketing landing (which has its own layout).
 *
 * Fire-and-forget: no list to keep in an SWR cache, so it's a plain
 * jsonFetch POST with local state (mirrors NewCollection / the admin editors).
 * The submit ROUTE is the real auth gate (401 when signed out); this widget is
 * only shown to signed-in users by its server-side launcher gate.
 *
 * Three fields per spec: category (Bug/Idea/Other, default Other), an optional
 * 1–5 star rating, and a required long-text message. `page` (the current in-app
 * path) is captured at submit time for triage.
 */

const CATEGORY_LABELS: Record<FeedbackCategory, string> = {
  bug: "Bug",
  idea: "Idea",
  other: "Other",
};

type Status = "idle" | "sending" | "sent" | "error";

export default function FeedbackWidget() {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<FeedbackCategory>("other");
  const [rating, setRating] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const messageRef = useRef<HTMLTextAreaElement>(null);

  // Focus the message field when the panel opens (after the reset below).
  useEffect(() => {
    if (open && status === "idle") messageRef.current?.focus();
  }, [open, status]);

  function reset() {
    setCategory("other");
    setRating(null);
    setMessage("");
    setStatus("idle");
    setError(null);
  }

  function close() {
    setOpen(false);
    // Reset after the panel is dismissed so a re-open starts fresh.
    reset();
  }

  async function submit() {
    if (!message.trim() || status === "sending") return;
    setStatus("sending");
    setError(null);
    try {
      const page =
        typeof window !== "undefined" ? window.location.pathname : "";
      await jsonFetch("/api/feedback", {
        method: "POST",
        body: JSON.stringify({ category, rating, message, page }),
      });
      setStatus("sent");
    } catch (e) {
      setStatus("error");
      setError((e as Error).message || "Could not send feedback.");
    }
  }

  return (
    <>
      {/* The floating launcher — fixed, bottom-right, above page content. */}
      <button
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        aria-expanded={open}
        aria-label="Feedback"
        className="fixed bottom-4 right-4 z-40 rounded-full px-4 py-2.5 text-sm font-bold shadow-lg transition-transform hover:-translate-y-0.5"
        style={{ background: "var(--accent)", color: "var(--accent-ink)" }}
      >
        💬 Feedback
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="false"
          aria-label="Send feedback"
          className="card fixed bottom-20 right-4 z-40 w-[min(22rem,calc(100vw-2rem))] p-4 shadow-xl space-y-3"
        >
          {status === "sent" ? (
            <div className="space-y-3 text-center py-2">
              <div className="text-3xl" aria-hidden>
                🙌
              </div>
              <div className="font-extrabold">Thanks for your feedback!</div>
              <p className="muted text-sm">
                We read every message — it helps us make Lexi better.
              </p>
              <button className="btn btn-primary w-full" onClick={close}>
                Done
              </button>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <div className="font-extrabold">Send feedback</div>
                <button
                  type="button"
                  aria-label="Close feedback"
                  onClick={close}
                  className="muted text-lg leading-none px-1"
                >
                  ✕
                </button>
              </div>

              <div>
                <label
                  htmlFor="feedback-category"
                  className="block text-sm font-bold mb-1"
                >
                  Category
                </label>
                <select
                  id="feedback-category"
                  className="input"
                  value={category}
                  onChange={(e) =>
                    setCategory(e.target.value as FeedbackCategory)
                  }
                >
                  {FEEDBACK_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {CATEGORY_LABELS[c]}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-bold mb-1">
                  Rating <span className="muted font-normal">(optional)</span>
                </label>
                <div
                  className="flex gap-1"
                  role="radiogroup"
                  aria-label="Rating"
                >
                  {[1, 2, 3, 4, 5].map((n) => {
                    const on = rating != null && n <= rating;
                    return (
                      <button
                        key={n}
                        type="button"
                        role="radio"
                        aria-checked={rating === n}
                        aria-label={`${n} star${n === 1 ? "" : "s"}`}
                        // Click the current rating again to clear it.
                        onClick={() => setRating(rating === n ? null : n)}
                        className="text-2xl leading-none transition-transform hover:scale-110"
                        style={{ color: on ? "var(--accent)" : "var(--line)" }}
                      >
                        {on ? "★" : "☆"}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label
                  htmlFor="feedback-message"
                  className="block text-sm font-bold mb-1"
                >
                  Message
                </label>
                <textarea
                  id="feedback-message"
                  ref={messageRef}
                  className="input"
                  rows={4}
                  placeholder="What's on your mind?"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                />
              </div>

              {status === "error" && (
                <p className="text-sm" style={{ color: "var(--danger, #dc2626)" }} role="alert">
                  {error}
                </p>
              )}

              <button
                className="btn btn-primary w-full"
                onClick={submit}
                disabled={status === "sending" || !message.trim()}
              >
                {status === "sending" ? "Sending…" : "Send feedback"}
              </button>
            </>
          )}
        </div>
      )}
    </>
  );
}
