"use client";

/*
 * The student's trust card (design report §5.2 / §6) — front-and-centre on the
 * enrolled-class detail. It names exactly WHO can see the student ("● [Teacher]
 * can see your full Lexi report") and states that leaving stops it immediately.
 * Non-surprising visibility is a first-class privacy requirement, so this is not
 * decorative — it must always name the teacher(s) with access.
 */
export default function TrustCard({
  teacherNames,
  onLeave,
  leaving = false,
}: {
  teacherNames: string[];
  onLeave?: () => void;
  leaving?: boolean;
}) {
  const who =
    teacherNames.length === 0
      ? "Your teacher"
      : teacherNames.length === 1
        ? teacherNames[0]
        : `${teacherNames.slice(0, -1).join(", ")} and ${teacherNames[teacherNames.length - 1]}`;

  return (
    <div
      className="card p-5"
      style={{ background: "var(--accent-soft)", borderColor: "var(--accent)" }}
    >
      <div className="flex items-start gap-3">
        <span aria-hidden style={{ color: "var(--accent)" }}>
          ●
        </span>
        <div className="flex-1 space-y-2">
          <p className="font-bold">{who} can see your full Lexi report</p>
          <p className="muted text-sm">
            — every word, attempt, streak and essay band, updated live. Leaving
            stops this immediately.
          </p>
          {onLeave && (
            <button
              type="button"
              className="btn mt-1"
              onClick={onLeave}
              disabled={leaving}
            >
              {leaving ? "Leaving…" : "Leave class"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
