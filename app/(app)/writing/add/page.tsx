import Link from "next/link";
import AddPrompt from "@/components/writing/AddPrompt";

export default function AddWritingPrompt() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-extrabold tracking-tight">Add a writing question</h1>
        <Link href="/writing" className="btn">
          ← Back
        </Link>
      </div>
      <p className="muted text-sm">
        Task 2: paste the essay prompt. Task 1: paste the question and the chart image — the app reads
        the chart once so you can confirm the numbers, then it&apos;s ready to practise.
      </p>
      <AddPrompt />
    </div>
  );
}
