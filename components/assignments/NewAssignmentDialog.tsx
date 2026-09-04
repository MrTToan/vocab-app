"use client";

import { useState } from "react";
import { jsonFetch } from "@/lib/ui";
import { useAssignmentKinds, useAssignableContent, revalidateAssignments, revalidateClasses } from "@/lib/swr";
import type { RosterEntry } from "@/lib/classes/types";
import type { AssignmentRow, PickableContent } from "@/lib/assignments/types";

/*
 * "New assignment" — the unified, kind-aware picker. The tab strip and content
 * list are registry-driven (GET /api/assignments/kinds, /content?kind=), so a new
 * kind appears here with no change to this component. Slice 1: pick a vocab set
 * (public or the teacher's own private) → choose specific students → optional due
 * date → assign.
 */
export default function NewAssignmentDialog({
  classId,
  students,
  onCreated,
}: {
  classId: string;
  students: RosterEntry[];
  onCreated: () => void;
}) {
  const [open, setOpen] = useState(false);
  if (students.length === 0) {
    return <p className="muted text-sm">Add students to the class before assigning work.</p>;
  }
  return (
    <>
      <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
        + New assignment
      </button>
      {open && (
        <Dialog
          classId={classId}
          students={students}
          onClose={() => setOpen(false)}
          onCreated={() => {
            setOpen(false);
            onCreated();
          }}
        />
      )}
    </>
  );
}

function Dialog({
  classId,
  students,
  onClose,
  onCreated,
}: {
  classId: string;
  students: RosterEntry[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const { data: kindsData } = useAssignmentKinds();
  const kinds = kindsData?.kinds ?? [];
  const [kind, setKind] = useState<string | null>(null);
  const activeKind = kind ?? kinds[0]?.kind ?? null;

  const [q, setQ] = useState("");
  const { data: contentData, isLoading } = useAssignableContent(activeKind, q);
  const content = contentData?.content ?? [];

  const [ref, setRef] = useState<PickableContent | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [due, setDue] = useState("");
  const [title, setTitle] = useState("");
  const [instructions, setInstructions] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allSelected = selected.size === students.length && students.length > 0;
  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(students.map((s) => s.user_id)));

  async function assign() {
    if (!ref || selected.size === 0) return;
    setBusy(true);
    setError(null);
    // End-of-day local time for the due date (or none).
    const dueAt = due ? new Date(`${due}T23:59:59`).getTime() : null;
    try {
      await jsonFetch<{ assignment: AssignmentRow }>(`/api/classes/${classId}/assignments`, {
        method: "POST",
        body: JSON.stringify({
          kind: ref.kind,
          ref: ref.ref,
          title: title.trim() || undefined,
          instructions: instructions.trim() || undefined,
          dueAt,
          studentIds: [...selected],
        }),
      });
      await Promise.all([revalidateAssignments(), revalidateClasses()]);
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't create the assignment.");
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "color-mix(in srgb, var(--ink) 45%, transparent)" }}
      role="dialog"
      aria-modal="true"
      aria-label="New assignment"
    >
      <div className="card p-6 w-full max-w-lg space-y-5 max-h-[90vh] overflow-y-auto">
        <h2 className="text-xl font-extrabold tracking-tight">New assignment</h2>

        {/* 1 · pick content */}
        <div className="space-y-2">
          <p className="text-sm font-semibold">1 · Pick content</p>
          {kinds.length > 1 && (
            <div className="flex gap-1 flex-wrap">
              {kinds.map((k) => {
                const on = k.kind === activeKind;
                return (
                  <button
                    key={k.kind}
                    type="button"
                    className="px-3 py-1.5 rounded-lg text-sm font-semibold"
                    style={
                      on
                        ? { background: "var(--accent)", color: "var(--accent-ink)" }
                        : { color: "var(--muted)" }
                    }
                    onClick={() => {
                      setKind(k.kind);
                      setRef(null);
                    }}
                  >
                    {k.emoji} {k.label}
                  </button>
                );
              })}
            </div>
          )}
          <input
            className="input"
            placeholder="Search sets…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search content"
          />
          <div
            className="max-h-52 overflow-y-auto rounded-lg divide-y"
            style={{ borderColor: "var(--line)", border: "1px solid var(--line)" }}
          >
            {isLoading ? (
              <p className="muted text-sm p-3">Loading…</p>
            ) : content.length === 0 ? (
              <p className="muted text-sm p-3">No matching content.</p>
            ) : (
              content.map((c) => {
                const on = ref?.ref === c.ref;
                return (
                  <button
                    key={c.ref}
                    type="button"
                    className="w-full text-left p-3 flex items-center justify-between gap-3"
                    style={on ? { background: "var(--accent-soft)" } : undefined}
                    onClick={() => setRef(c)}
                  >
                    <span className="font-semibold truncate">
                      {c.emoji ? `${c.emoji} ` : ""}
                      {c.title}
                    </span>
                    <span className="muted text-xs whitespace-nowrap">{c.subtitle}</span>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* 2 · assign to */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold">2 · Assign to</p>
            <button type="button" className="text-xs font-semibold" style={{ color: "var(--accent)" }} onClick={toggleAll}>
              {allSelected ? "Clear all" : "Select all"}
            </button>
          </div>
          <div
            className="max-h-40 overflow-y-auto rounded-lg p-2 space-y-1"
            style={{ border: "1px solid var(--line)" }}
          >
            {students.map((s) => (
              <label key={s.user_id} className="flex items-center gap-2 text-sm py-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selected.has(s.user_id)}
                  onChange={() => toggle(s.user_id)}
                />
                <span className="font-semibold truncate">{s.name || s.email || "—"}</span>
              </label>
            ))}
          </div>
        </div>

        {/* 3 · options */}
        <div className="space-y-2">
          <p className="text-sm font-semibold">3 · Options</p>
          <label htmlFor="due" className="text-xs muted">
            Due date (optional)
          </label>
          <input id="due" type="date" className="input" value={due} onChange={(e) => setDue(e.target.value)} />
          <input
            className="input"
            placeholder="Title (defaults to the set's name)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            aria-label="Title"
          />
          <textarea
            className="input"
            placeholder="Note to students (optional)"
            value={instructions}
            rows={2}
            onChange={(e) => setInstructions(e.target.value)}
            aria-label="Instructions"
          />
        </div>

        {error && (
          <p role="alert" className="text-sm" style={{ color: "var(--bad)" }}>
            {error}
          </p>
        )}

        <div className="flex gap-2 justify-end">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={assign}
            disabled={busy || !ref || selected.size === 0}
          >
            {busy ? "Assigning…" : "Assign →"}
          </button>
        </div>
      </div>
    </div>
  );
}
