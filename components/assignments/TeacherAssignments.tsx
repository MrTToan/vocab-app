"use client";

import Link from "next/link";
import { useClassAssignments, revalidateAssignments } from "@/lib/swr";
import type { RosterEntry } from "@/lib/classes/types";
import type { TeacherAssignment } from "@/lib/assignments/types";
import NewAssignmentDialog from "./NewAssignmentDialog";
import { dueLabel, OverdueFlag } from "./parts";

/**
 * The teacher's Assignments section inside a class — a list of the class's active
 * assignments (each linking to its per-student completion view) plus the
 * "New assignment" picker. Rendered on /classes/[id] above the roster.
 */
export default function TeacherAssignments({
  classId,
  students,
}: {
  classId: string;
  students: RosterEntry[];
}) {
  const { data, isLoading, mutate } = useClassAssignments(classId);
  const assignments: TeacherAssignment[] =
    data && data.role === "teacher" ? data.assignments : [];

  return (
    <section className="card p-5 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-bold">Assignments</h3>
        <NewAssignmentDialog
          classId={classId}
          students={students}
          onCreated={() => {
            void revalidateAssignments();
            void mutate();
          }}
        />
      </div>

      {isLoading ? (
        <p className="muted text-sm">Loading…</p>
      ) : assignments.length === 0 ? (
        <p className="muted text-sm">
          No assignments yet. Assign a vocabulary set to some of your students to get started.
        </p>
      ) : (
        <ul className="space-y-2">
          {assignments.map((a) => (
            <li key={a.id}>
              <Link
                href={`/assignments/${a.id}`}
                className="card p-3 flex items-center justify-between gap-3 hover:opacity-90 transition-opacity"
              >
                <div className="min-w-0">
                  <div className="font-semibold truncate">
                    {a.content.emoji ? `${a.content.emoji} ` : ""}
                    {a.title}
                  </div>
                  <div className="muted text-xs mt-0.5 flex items-center gap-2 flex-wrap">
                    <span>{a.content.subtitle}</span>
                    <span aria-hidden>·</span>
                    <span>
                      {a.targetCount} {a.targetCount === 1 ? "student" : "students"}
                    </span>
                    {dueLabel(a.due_at) ? (
                      <>
                        <span aria-hidden>·</span>
                        <span>Due {dueLabel(a.due_at)}</span>
                      </>
                    ) : null}
                    <OverdueFlag overdue={a.overdue} />
                  </div>
                </div>
                <div className="text-sm font-semibold whitespace-nowrap" style={{ color: "var(--accent)" }}>
                  ✔ {a.completeCount} / {a.targetCount}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
