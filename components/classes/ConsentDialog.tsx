"use client";

import { CONSENT_NOTICE } from "@/lib/classes/types";

/*
 * The shared consent screen (design report §5.3) — shown before ANY join write,
 * from both the code-redeem box and (later) an email invite. It names the class
 * AND the teacher and states plainly that joining shares the student's WHOLE
 * Lexi report, updated live, and that leaving stops it. The affirmative button
 * ("Join & share") IS the consent event: the join path must never be reached
 * without it. This is a launch gate — do not bypass it.
 */
export default function ConsentDialog({
  name,
  emoji,
  teacherName,
  busy = false,
  error = null,
  onCancel,
  onConfirm,
}: {
  name: string;
  emoji?: string;
  teacherName: string;
  busy?: boolean;
  error?: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "color-mix(in srgb, var(--ink) 45%, transparent)" }}
      role="dialog"
      aria-modal="true"
      aria-label={`Join ${name}?`}
    >
      <div className="card p-6 w-full max-w-md space-y-4">
        <div>
          <h2 className="text-xl font-extrabold tracking-tight">
            Join {emoji ? `${emoji} ` : ""}
            &ldquo;{name}&rdquo;?
          </h2>
          <p className="muted mt-1 text-sm">Teacher: {teacherName}</p>
        </div>

        <div
          className="rounded-xl p-4 text-sm leading-relaxed"
          style={{ background: "var(--accent-soft)", color: "var(--ink)" }}
        >
          {CONSENT_NOTICE}
        </div>

        {error && (
          <p role="alert" className="text-sm" style={{ color: "var(--bad)" }}>
            {error}
          </p>
        )}

        <div className="flex gap-2 justify-end pt-1">
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? "Joining…" : "Join & share"}
          </button>
        </div>
      </div>
    </div>
  );
}
