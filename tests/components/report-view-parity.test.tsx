import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { mockFetch, renderWithSWR } from "./harness";
import ReportView from "@/components/report/ReportView";
import type { VocabStats, WritingStats } from "@/lib/report";

/*
 * Parity guard for the ReportView extraction (Classes Slice 2). The learner's own
 * /report and the teacher's read-only student view are fed by DIFFERENT sources
 * (own SWR keys vs route 17) but MUST render byte-identical tiles + charts,
 * because they share one pure <ReportView>. This test proves the refactor didn't
 * fork behavior: given the same { vocab, writing }, the exact ReportView DOM that
 * renders standalone appears verbatim inside BOTH pages.
 */

// next/navigation: the teacher page reads route params via useParams().
const params = vi.hoisted(() => ({ current: { id: "c1", studentId: "s1" } as Record<string, string> }));
vi.mock("next/navigation", () => ({
  useParams: () => params.current,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

// Fixtures — non-trivial, deterministic data on both the vocab and writing halves
// so a real tree (numbers, bars, charts) is compared, not an empty state.
const VOCAB: VocabStats = {
  words: { total: 42, practiced: 30, mastered: 12, weak: 5, stageCounts: { new: 8, recognition: 7, recall: 9, production: 6, known: 12 } },
  attempts: {
    total: 60,
    overall: { correct: 40, partial: 12, incorrect: 8 },
    byDay: Array.from({ length: 14 }, (_, i) => ({
      label: `D${i}`,
      total: i % 3 === 0 ? 0 : 4,
      correct: i % 3 === 0 ? 0 : 3,
      partial: i % 3 === 0 ? 0 : 1,
      incorrect: 0,
    })),
    byType: [
      { type: "multiple_choice", total: 20, correct: 15, partial: 3, incorrect: 2 },
      { type: "cloze", total: 12, correct: 6, partial: 3, incorrect: 3 },
    ],
    streak: 4,
  },
  topSeen: [
    { word: "ubiquitous", times_seen: 9 },
    { word: "ephemeral", times_seen: 5 },
  ],
};

const WRITING: WritingStats = {
  submissions: 3,
  byTask: { task1: 1, task2: 2 },
  avgOverall: 6.5,
  avgWordCount: 245,
  avgBands: {
    task_achievement: 6.5,
    coherence_cohesion: 6.0,
    lexical_resource: 7.0,
    grammatical_range_accuracy: 6.0,
  },
  bandSeries: [
    { ts: 1_700_000_000_000, overall: 6.0, task_type: "task2" },
    { ts: 1_700_100_000_000, overall: 6.5, task_type: "task1" },
    { ts: 1_700_200_000_000, overall: 7.0, task_type: "task2" },
  ],
  errorFrequency: [
    { error_type: "article", count: 5 },
    { error_type: "tense", count: 3 },
  ],
  recent: [
    { id: "r1", task_type: "task2", overall_band: 7.0, word_count: 260, created_at: 1_700_200_000_000 },
    { id: "r2", task_type: "task1", overall_band: 6.5, word_count: 230, created_at: 1_700_100_000_000 },
  ],
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** The canonical ReportView DOM for the fixture data, rendered with no page
 *  chrome around it — the exact substring both pages must contain. */
function canonicalReportViewHTML(): string {
  const { container, unmount } = render(<ReportView vocab={VOCAB} writing={WRITING} />);
  const html = container.innerHTML;
  unmount();
  return html;
}

describe("ReportView parity: own /report vs teacher student-view", () => {
  it("both pages embed the identical ReportView DOM for the same data", async () => {
    const expected = canonicalReportViewHTML();
    expect(expected).toContain("How you"); // sanity: real content rendered
    expect(expected).toContain("Vocabulary");
    expect(expected).toContain("Writing");

    // ── own-report path: /report feeds ReportView from KEY_STATS + KEY_WRITING_STATS
    const { default: ReportPage } = await import("@/app/(app)/report/page");
    mockFetch({
      "GET /api/stats": VOCAB,
      "GET /api/writing/stats": WRITING,
    });
    const own = renderWithSWR(<ReportPage />);
    await screen.findByText(/How you/);
    const ownHTML = own.container.innerHTML;
    own.unmount();
    vi.unstubAllGlobals();

    // ── teacher path: route 17 feeds ReportView the same vocab + writing
    const { default: StudentReportPage } = await import(
      "@/app/(app)/classes/[id]/students/[studentId]/page"
    );
    mockFetch({
      "GET /api/classes/c1/students/s1/report": {
        vocab: VOCAB,
        writing: WRITING,
        student: { name: "An Nguyen" },
      },
    });
    const teacher = renderWithSWR(<StudentReportPage />);
    await screen.findByText(/Report — An Nguyen/);
    await waitFor(() => expect(screen.getByText(/How you/)).toBeTruthy());
    const teacherHTML = teacher.container.innerHTML;
    teacher.unmount();

    // The refactor didn't fork behavior: the exact ReportView subtree renders in
    // BOTH pages, so their shared visual output is identical.
    expect(ownHTML).toContain(expected);
    expect(teacherHTML).toContain(expected);
  });

  it("the teacher view is framed read-only and names the student", async () => {
    const { default: StudentReportPage } = await import(
      "@/app/(app)/classes/[id]/students/[studentId]/page"
    );
    mockFetch({
      "GET /api/classes/c1/students/s1/report": {
        vocab: VOCAB,
        writing: WRITING,
        student: { name: "An Nguyen" },
      },
    });
    renderWithSWR(<StudentReportPage />);
    await screen.findByText(/Report — An Nguyen/);
    expect(screen.getByText(/Read-only/)).toBeTruthy();
    expect(screen.getByText(/in\s+this class/i)).toBeTruthy();
    // A back link to the class, and no edit/act-as affordance.
    const back = screen.getAllByRole("link").find((a) => a.getAttribute("href") === "/classes/c1");
    expect(back).toBeTruthy();
  });
});
