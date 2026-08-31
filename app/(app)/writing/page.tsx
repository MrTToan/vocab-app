import Link from "next/link";

// Writing module landing. IELTS Academic — two sub-modules (Task 1 chart
// description, Task 2 essay). Scaffolded in Step 1; the practice loops land in
// later steps (see docs/WRITING-SPEC.md).
export default function WritingHome() {
  return (
    <div className="space-y-6">
      <section className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">Writing — IELTS Academic</h1>
          <p className="muted mt-1">
            Write an answer, get feedback graded against the four IELTS criteria with inline
            corrections. One-shot feedback, no repeats.
          </p>
        </div>
        <Link href="/writing/add" className="btn btn-primary whitespace-nowrap">
          ＋ Add a question
        </Link>
      </section>

      <section className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Link href="/writing/task1" className="card p-5 hover:opacity-90">
          <div className="font-bold text-lg">Task 1</div>
          <div className="muted text-sm mt-1">
            Describe a chart, graph or diagram in at least 150 words.
          </div>
          <div className="chip mt-3 inline-block">≥ 150 words · 20 min</div>
        </Link>
        <Link href="/writing/task2" className="card p-5 hover:opacity-90">
          <div className="font-bold text-lg">Task 2</div>
          <div className="muted text-sm mt-1">
            Write an essay responding to an argument or opinion in at least 250 words.
          </div>
          <div className="chip mt-3 inline-block">≥ 250 words · 40 min</div>
        </Link>
      </section>

      <p className="muted text-xs">
        This module is being built — see the design in <code>docs/WRITING-SPEC.md</code>.
      </p>
    </div>
  );
}
