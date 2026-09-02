import Link from "next/link";

// Writing module landing. IELTS Academic — two sub-modules (Task 1 chart
// description, Task 2 essay). Feature behaviour: docs/features/writing-feedback.md.
export default function WritingHome() {
  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-3xl font-extrabold tracking-tight">Writing — IELTS Academic</h1>
        <p className="muted mt-1">
          Write an answer, get feedback graded against the four IELTS criteria with inline
          corrections. One-shot feedback, no repeats.
        </p>
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

      <section className="card p-5">
        <div className="font-bold">How it works</div>
        <ol className="muted text-sm mt-2 space-y-1 list-decimal list-inside">
          <li>Pick a question from the curated Task 1 or Task 2 bank.</li>
          <li>Write your answer against the exam clock.</li>
          <li>Get a band score on all four criteria, with inline corrections you can discuss.</li>
        </ol>
      </section>
    </div>
  );
}
