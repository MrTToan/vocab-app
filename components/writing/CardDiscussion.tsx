"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { WritingDiscussionMessage } from "@/lib/writing/types";

/*
 * A "Discuss with the AI" thread that hangs under one feedback card. Two modes:
 *  - inline: compact, lives under the card.
 *  - expanded: a large centered pop-up (portal → body) with room for the whole
 *    conversation. Same underlying messages/onSend — the parent (Feedback) owns
 *    the per-card message map, this is just the view + composer.
 */
export default function CardDiscussion({
  messages,
  busy,
  onSend,
  accent = "var(--accent)",
  title = "Discuss this feedback",
}: {
  messages: WritingDiscussionMessage[];
  busy: boolean;
  onSend: (text: string) => void | Promise<void>;
  accent?: string;
  title?: string;
}) {
  const [open, setOpen] = useState(messages.length > 0);
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement | null>(null);

  // Esc closes the modal.
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [expanded]);

  // Keep the newest message in view (mainly in the modal).
  useEffect(() => {
    if (expanded) bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, busy, expanded]);

  function submit() {
    const t = draft.trim();
    if (!t || busy) return;
    onSend(t);
    setDraft("");
  }

  const bubbles = (big: boolean) => (
    <>
      {messages.map((m) => (
        <div
          key={m.id}
          className={`rounded-lg ${big ? "px-3.5 py-2 text-sm" : "px-2.5 py-1.5 text-[13px]"}`}
          style={
            m.role === "user"
              ? { background: "var(--accent-soft)", marginLeft: big ? "3rem" : "1.5rem" }
              : { background: "var(--card-2, rgba(127,127,127,0.08))", marginRight: big ? "1.5rem" : "0.5rem" }
          }
        >
          <div className="text-[10px] font-bold muted mb-0.5">{m.role === "user" ? "You" : "AI tutor"}</div>
          <div className="whitespace-pre-wrap leading-relaxed">{m.content}</div>
        </div>
      ))}
      {busy && <div className="text-[12px] muted pl-1">AI tutor is thinking…</div>}
      <div ref={bottomRef} />
    </>
  );

  const composer = (big: boolean) => (
    <div className="flex items-end gap-2">
      <textarea
        className={`input leading-snug ${big ? "text-sm min-h-[52px] py-2" : "text-[13px] min-h-[38px] py-1.5"}`}
        rows={big ? 2 : 1}
        placeholder="Ask why, or for an example rewrite…"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
        disabled={busy}
        autoFocus={big}
      />
      <button className="btn btn-primary shrink-0" onClick={submit} disabled={busy || !draft.trim()}>
        Send
      </button>
    </div>
  );

  return (
    <div className="mt-2 pt-2" style={{ borderTop: "1px dashed var(--line)" }}>
      <div className="flex items-center gap-3 no-print">
        <button
          className="text-xs font-semibold flex items-center gap-1"
          style={{ color: accent }}
          onClick={(e) => {
            e.stopPropagation();
            setOpen((o) => !o);
          }}
        >
          💬 {open ? "Hide discussion" : "Discuss with the AI"}
          {messages.length > 0 && (
            <span className="chip" style={{ padding: "0 6px" }}>
              {messages.filter((m) => m.role === "user").length}
            </span>
          )}
        </button>
        <button
          className="text-xs muted hover:underline"
          onClick={(e) => {
            e.stopPropagation();
            setOpen(true);
            setExpanded(true);
          }}
          title="Open in a bigger window"
        >
          ⤢ Expand
        </button>
      </div>

      {open && !expanded && (
        <div className="mt-2 space-y-2" onClick={(e) => e.stopPropagation()}>
          {bubbles(false)}
          {composer(false)}
        </div>
      )}

      {expanded &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ background: "rgba(0,0,0,0.5)" }}
            onClick={() => setExpanded(false)}
          >
            <div
              className="card w-full max-w-2xl flex flex-col p-0"
              style={{ maxHeight: "85vh" }}
              onClick={(e) => e.stopPropagation()}
            >
              <div
                className="flex items-center justify-between gap-3 px-5 py-3"
                style={{ borderBottom: "1px solid var(--line)" }}
              >
                <div className="font-bold text-sm truncate" style={{ color: accent }}>
                  💬 {title}
                </div>
                <button className="btn shrink-0" onClick={() => setExpanded(false)}>
                  Close ✕
                </button>
              </div>
              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
                {messages.length === 0 && (
                  <p className="muted text-sm">
                    Ask anything about this feedback — why you got it, or for an example rewrite.
                  </p>
                )}
                {bubbles(true)}
              </div>
              <div className="px-5 py-3" style={{ borderTop: "1px solid var(--line)" }}>
                {composer(true)}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
