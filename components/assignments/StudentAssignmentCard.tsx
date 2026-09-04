import Link from "next/link";
import type { StudentAssignment } from "@/lib/assignments/types";
import { dueLabel, OverdueFlag, ProgressPill } from "./parts";

/**
 * One assignment as a student sees it — on the /classes hub, in a class, and on
 * the assignment page. "Start →" routes into the EXISTING doing-flow via the
 * server-resolved `content.doHref` (e.g. /practice?collection=<id>); the card is
 * kind-agnostic. `showClass` labels which class it's from (the hub roll-up).
 */
export default function StudentAssignmentCard({
  a,
  showClass = false,
}: {
  a: StudentAssignment;
  showClass?: boolean;
}) {
  const due = dueLabel(a.due_at);
  return (
    <div className="card p-4 flex flex-col gap-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-bold truncate">
            {a.content.emoji ? `${a.content.emoji} ` : ""}
            {a.title}
          </div>
          <div className="muted text-sm mt-0.5 truncate">
            {showClass ? `${a.classEmoji ? `${a.classEmoji} ` : ""}${a.className} · ` : ""}
            {a.content.subtitle}
          </div>
        </div>
        <ProgressPill progress={a.progress} />
      </div>

      {a.instructions ? <p className="text-sm">{a.instructions}</p> : null}

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 text-xs muted">
          {due ? <span>Due {due}</span> : <span>No due date</span>}
          <OverdueFlag overdue={a.overdue} />
        </div>
        {a.content.available ? (
          <Link href={a.content.doHref} className="btn btn-primary">
            {a.progress.state === "complete" ? "Practise again →" : "Start →"}
          </Link>
        ) : (
          <span className="text-xs" style={{ color: "var(--bad)" }}>
            This content is no longer available
          </span>
        )}
      </div>
    </div>
  );
}
