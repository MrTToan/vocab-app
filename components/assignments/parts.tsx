import type { AssignmentProgress } from "@/lib/assignments/types";

/** A human due-date label, or null when there is no due date. */
export function dueLabel(dueAt: number | null): string | null {
  if (dueAt == null) return null;
  return new Date(dueAt).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** The completion pill a student/teacher sees. Vocab completion is "practised at
 *  least once", so the states in play are Not started / Practised. */
export function ProgressPill({ progress }: { progress: AssignmentProgress }) {
  const done = progress.state === "complete";
  return (
    <span
      className="inline-flex items-center gap-1 text-xs font-semibold whitespace-nowrap"
      style={{ color: done ? "var(--good)" : "var(--muted)" }}
      title={progress.detail}
    >
      <span aria-hidden>{done ? "✔" : "○"}</span>
      {done ? "Practised" : "Not started"}
    </span>
  );
}

/** A small "Overdue" flag (derived live: past due and not complete). */
export function OverdueFlag({ overdue }: { overdue: boolean }) {
  if (!overdue) return null;
  return (
    <span
      className="inline-flex items-center gap-1 text-xs font-semibold whitespace-nowrap"
      style={{ color: "var(--bad)" }}
    >
      <span aria-hidden>⚠</span> Overdue
    </span>
  );
}
