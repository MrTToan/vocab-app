"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { jsonFetch } from "@/lib/ui";
import { useAssignment, revalidateAssignments, revalidateClasses } from "@/lib/swr";
import type { AssignmentDetail } from "@/lib/assignments/types";
import StudentAssignmentCard from "@/components/assignments/StudentAssignmentCard";
import { dueLabel, OverdueFlag, ProgressPill } from "@/components/assignments/parts";

/*
 * /assignments/[id] — one assignment. Role-shaped by the server: the teacher sees
 * the per-student completion grid; a targeted student sees their own card (and can
 * start it). A non-member / non-target gets a 404 (SWR error).
 */
export default function AssignmentPage() {
  const params = useParams<{ assignmentId: string }>();
  const id = params.assignmentId;
  const { data, error, isLoading } = useAssignment(id);

  if (isLoading) return <p className="muted">Loading…</p>;
  if (error || !data) {
    return (
      <div className="space-y-3">
        <p className="muted">This assignment isn&rsquo;t available.</p>
        <Link href="/classes" className="btn">
          ← Back to Classes
        </Link>
      </div>
    );
  }
  return data.role === "teacher" ? <TeacherView detail={data} /> : <StudentView detail={data} />;
}

function TeacherView({ detail }: { detail: Extract<AssignmentDetail, { role: "teacher" }> }) {
  return (
    <div className="space-y-6">
      <section className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href={`/classes/${detail.classId}`} className="muted text-sm">
            ← {detail.className}
          </Link>
          <h1 className="text-3xl font-extrabold tracking-tight mt-1">
            {detail.content.emoji ? `${detail.content.emoji} ` : ""}
            {detail.title}
          </h1>
          <p className="muted mt-1 flex items-center gap-2 flex-wrap">
            <span>{detail.content.subtitle}</span>
            <span aria-hidden>·</span>
            <span>
              {detail.completeCount} / {detail.targetCount} practised
            </span>
            {dueLabel(detail.due_at) ? (
              <>
                <span aria-hidden>·</span>
                <span>Due {dueLabel(detail.due_at)}</span>
              </>
            ) : null}
          </p>
        </div>
        <ArchiveButton assignmentId={detail.id} classId={detail.classId} />
      </section>

      {detail.instructions ? <p className="text-sm">{detail.instructions}</p> : null}

      <section className="card p-5 space-y-3">
        <h3 className="font-bold">Completion</h3>
        {detail.students.length === 0 ? (
          <p className="muted text-sm">
            No targeted students are in this class any more.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="muted text-left" style={{ borderBottom: "1px solid var(--line)" }}>
                  <th className="py-2 font-semibold">Name</th>
                  <th className="py-2 font-semibold">Progress</th>
                  <th className="py-2 font-semibold">Status</th>
                  <th className="py-2 font-semibold">Report</th>
                </tr>
              </thead>
              <tbody>
                {detail.students.map((s) => {
                  return (
                    <tr key={s.user_id} style={{ borderBottom: "1px solid var(--line)" }}>
                      <td className="py-2 font-semibold">{s.name || s.email || "—"}</td>
                      <td className="py-2 muted">{s.progress.detail}</td>
                      <td className="py-2">
                        <div className="flex items-center gap-2">
                          <ProgressPill progress={s.progress} />
                          <OverdueFlag overdue={s.overdue} />
                        </div>
                      </td>
                      <td className="py-2">
                        <Link
                          href={`/classes/${detail.classId}/students/${s.user_id}`}
                          style={{ color: "var(--accent)", fontWeight: 600 }}
                        >
                          View →
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function ArchiveButton({ assignmentId, classId }: { assignmentId: string; classId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  async function archive() {
    setBusy(true);
    try {
      await jsonFetch(`/api/assignments/${assignmentId}`, { method: "DELETE" });
      await Promise.all([revalidateAssignments(), revalidateClasses()]);
      router.push(`/classes/${classId}`);
    } catch {
      setBusy(false);
    }
  }
  if (!confirming) {
    return (
      <button type="button" className="btn" onClick={() => setConfirming(true)}>
        Archive
      </button>
    );
  }
  return (
    <button type="button" className="btn" onClick={archive} disabled={busy} style={{ color: "var(--bad)" }}>
      {busy ? "Archiving…" : "Confirm archive"}
    </button>
  );
}

function StudentView({ detail }: { detail: Extract<AssignmentDetail, { role: "student" }> }) {
  const a = detail.assignment;
  return (
    <div className="space-y-6">
      <section>
        <Link href={`/classes/${a.class_id}`} className="muted text-sm">
          ← {a.className}
        </Link>
        <h1 className="text-3xl font-extrabold tracking-tight mt-1">Assignment</h1>
      </section>
      <StudentAssignmentCard a={a} />
      <Link href="/classes" className="btn">
        ← Back to Classes
      </Link>
    </div>
  );
}
