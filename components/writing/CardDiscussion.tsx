"use client";

import { useState } from "react";
import type { WritingDiscussionMessage } from "@/lib/writing/types";

/*
 * A collapsible "Discuss with the AI" thread that hangs under one feedback card.
 * Controlled by the parent (Feedback owns the per-card message map): it renders
 * the thread + an input, and calls onSend for each new question.
 */
export default function CardDiscussion({
  messages,
  busy,
  onSend,
  accent = "var(--accent)",
}: {
  messages: WritingDiscussionMessage[];
  busy: boolean;
  onSend: (text: string) => void | Promise<void>;
  accent?: string;
}) {
  const [open, setOpen] = useState(messages.length > 0);
  const [draft, setDraft] = useState("");

  function submit() {
    const t = draft.trim();
    if (!t || busy) return;
    onSend(t);
    setDraft("");
  }

  return (
    <div className="mt-2 pt-2" style={{ borderTop: "1px dashed var(--line)" }}>
      <button
        className="text-xs font-semibold flex items-center gap-1 no-print"
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

      {open && (
        <div className="mt-2 space-y-2" onClick={(e) => e.stopPropagation()}>
          {messages.map((m) => (
            <div
              key={m.id}
              className="text-[13px] rounded-lg px-2.5 py-1.5"
              style={
                m.role === "user"
                  ? { background: "var(--accent-soft)", marginLeft: "1.5rem" }
                  : { background: "var(--card-2, rgba(127,127,127,0.08))", marginRight: "0.5rem" }
              }
            >
              <div className="text-[10px] font-bold muted mb-0.5">
                {m.role === "user" ? "You" : "AI tutor"}
              </div>
              <div className="whitespace-pre-wrap leading-snug">{m.content}</div>
            </div>
          ))}

          {busy && <div className="text-[12px] muted pl-1">AI tutor is thinking…</div>}

          <div className="flex items-end gap-2">
            <textarea
              className="input text-[13px] min-h-[38px] leading-snug py-1.5"
              rows={1}
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
            />
            <button className="btn btn-primary shrink-0" onClick={submit} disabled={busy || !draft.trim()}>
              Send
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
