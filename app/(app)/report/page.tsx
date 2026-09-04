"use client";

import Link from "next/link";
import useSWR from "swr";
import { fetcher, KEY_STATS, KEY_WRITING_STATS } from "@/lib/swr";
import type { VocabStats, WritingStats } from "@/lib/report";
import ReportView from "@/components/report/ReportView";

/*
 * The learner's own report. The tiles + charts live in the shared, pure
 * <ReportView> (components/report/ReportView.tsx) so the teacher's read-only view
 * of a student renders byte-identical output from the same component (route 17).
 * This page only owns the data fetching (own SWR keys), the page header, and the
 * personal practice CTA — none of which belong to a teacher looking at a student.
 */
export default function ReportPage() {
  // SWR: /api/stats is shared with (deduped against) Home; both payloads cache so
  // a repeat visit is instant and revalidates in the background.
  const { data: s = null } = useSWR<VocabStats>(KEY_STATS, fetcher);
  const { data: w = null } = useSWR<WritingStats>(KEY_WRITING_STATS, fetcher);

  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-3xl font-extrabold tracking-tight">Report</h1>
        <p className="muted mt-1">Your progress across every skill in one place.</p>
      </section>

      <ReportView vocab={s} writing={w} />

      <div className="flex gap-2 pt-2">
        <Link href="/practice" className="btn btn-primary">Practice vocabulary →</Link>
        <Link href="/writing" className="btn">Write →</Link>
      </div>
    </div>
  );
}
