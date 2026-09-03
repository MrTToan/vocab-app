"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useStudentReport } from "@/lib/swr";
import ReportView from "@/components/report/ReportView";

/*
 * /classes/[id]/students/[studentId] — the teacher's READ-ONLY view of one
 * student's full report (vocab + writing), the payoff of the Classes feature.
 * It fetches route 17, whose authorization is `teachesStudent` and nothing
 * looser; a non-teacher / wrong-teacher gets a 404 (surfaced here as the
 * "not available" state — existence isn't leaked). The report renders through
 * the SAME <ReportView> the student's own /report uses, so a teacher sees
 * exactly what the student sees — no edit, no act-as, only the aggregates.
 */
export default function StudentReportPage() {
  const params = useParams<{ id: string; studentId: string }>();
  const { id, studentId } = params;
  const { data, error, isLoading } = useStudentReport(id, studentId);

  if (isLoading) return <p className="muted">Loading…</p>;
  if (error || !data) {
    return (
      <div className="space-y-3">
        <p className="muted">This report isn&rsquo;t available.</p>
        <Link href={`/classes/${id}`} className="btn">
          ← Back to class
        </Link>
      </div>
    );
  }

  const name = data.student.name || "This student";

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <Link href={`/classes/${id}`} className="muted text-sm inline-flex items-center gap-1">
          ← Back to class
        </Link>
        <h1 className="text-3xl font-extrabold tracking-tight">Report — {name}</h1>
        <div
          className="card p-3 text-sm flex items-start gap-2"
          style={{ background: "var(--accent-soft)", borderColor: "var(--accent)" }}
        >
          <span aria-hidden>🔒</span>
          <span>
            <span className="font-semibold">Read-only</span> · shared with you because {name} is in
            this class. You can see their progress but can&rsquo;t change anything.
          </span>
        </div>
      </section>

      <ReportView vocab={data.vocab} writing={data.writing} />
    </div>
  );
}
