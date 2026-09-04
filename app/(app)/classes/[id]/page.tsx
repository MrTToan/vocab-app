"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { jsonFetch } from "@/lib/ui";
import { useClass, revalidateClasses, classKey } from "@/lib/swr";
import { mutate } from "swr";
import type {
  ClassDetail,
  ClassRow,
  CreatedInvite,
  CreateInvitesResult,
  RosterEntry,
  TeacherInvite,
} from "@/lib/classes/types";
import TrustCard from "@/components/classes/TrustCard";
import TeacherAssignments from "@/components/assignments/TeacherAssignments";
import StudentClassAssignments from "@/components/assignments/StudentClassAssignments";

/*
 * /classes/[id] — one class. The payload is role-shaped by the server: a teacher
 * gets the join code + roster; a student gets the trust card (who can see them).
 * A non-member gets a 404 from the API (existence isn't leaked).
 */
export default function ClassDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { data, error, isLoading } = useClass(id);

  if (isLoading) return <p className="muted">Loading…</p>;
  if (error || !data) {
    return (
      <div className="space-y-3">
        <p className="muted">This class isn&rsquo;t available.</p>
        <Link href="/classes" className="btn">
          ← Back to Classes
        </Link>
      </div>
    );
  }
  return data.role === "teacher" ? (
    <TeacherView id={id} detail={data} />
  ) : (
    <StudentView id={id} detail={data} />
  );
}

/* ── teacher ── */

function TeacherView({ id, detail }: { id: string; detail: Extract<ClassDetail, { role: "teacher" }> }) {
  const router = useRouter();
  const cls = detail.class;

  return (
    <div className="space-y-6">
      <section className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">
            {cls.emoji ? `${cls.emoji} ` : ""}
            {cls.name}
          </h1>
          <p className="muted mt-1">
            {detail.studentCount} {detail.studentCount === 1 ? "student" : "students"} · created{" "}
            {new Date(cls.created_at).toLocaleDateString()}
            {detail.archived ? " · archived" : ""}
          </p>
        </div>
        <div className="flex gap-2">
          <EditClass id={id} cls={cls} />
          {!detail.archived && <ArchiveButton id={id} onArchived={() => router.push("/classes")} />}
        </div>
      </section>

      {!detail.archived && <JoinCodeSection id={id} code={cls.join_code} />}

      {!detail.archived && <InviteByEmail id={id} invites={detail.invites} />}

      {!detail.archived && <TeacherAssignments classId={id} students={detail.students} />}

      <section className="card p-5 space-y-3">
        <h3 className="font-bold">Roster</h3>
        {detail.students.length === 0 ? (
          <p className="muted text-sm">No students yet. Share the join code to fill the roster.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="muted text-left" style={{ borderBottom: "1px solid var(--line)" }}>
                  <th className="py-2 font-semibold">Name</th>
                  <th className="py-2 font-semibold">Email</th>
                  <th className="py-2 font-semibold">Joined</th>
                  <th className="py-2 font-semibold">Report</th>
                  <th className="py-2 font-semibold text-right">Remove</th>
                </tr>
              </thead>
              <tbody>
                {detail.students.map((s) => (
                  <RosterRow key={s.user_id} id={id} student={s} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function RosterRow({ id, student }: { id: string; student: RosterEntry }) {
  const [busy, setBusy] = useState(false);
  async function remove() {
    setBusy(true);
    try {
      await jsonFetch(`/api/classes/${id}/students/${student.user_id}`, { method: "DELETE" });
      await revalidateClasses();
    } catch {
      setBusy(false);
    }
  }
  return (
    <tr style={{ borderBottom: "1px solid var(--line)" }}>
      <td className="py-2 font-semibold">{student.name || "—"}</td>
      <td className="py-2 muted">{student.email || "—"}</td>
      <td className="py-2 muted">
        {new Date(student.joined_at).toLocaleDateString()}
        {student.joined_via ? ` (${student.joined_via})` : ""}
      </td>
      <td className="py-2">
        <Link
          href={`/classes/${id}/students/${student.user_id}`}
          className="inline-flex items-center gap-1"
          style={{ color: "var(--accent)", fontWeight: 600 }}
        >
          View →
        </Link>
      </td>
      <td className="py-2 text-right">
        <button type="button" className="btn" onClick={remove} disabled={busy} aria-label={`Remove ${student.name || student.email}`}>
          ×
        </button>
      </td>
    </tr>
  );
}

function JoinCodeSection({ id, code }: { id: string; code: string | null }) {
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  async function rotate() {
    setBusy(true);
    try {
      await jsonFetch(`/api/classes/${id}/join-code`, { method: "POST" });
      await mutate(classKey(id));
      await revalidateClasses();
    } finally {
      setBusy(false);
    }
  }
  async function disable() {
    setBusy(true);
    try {
      await jsonFetch(`/api/classes/${id}/join-code`, { method: "DELETE" });
      await mutate(classKey(id));
      await revalidateClasses();
    } finally {
      setBusy(false);
    }
  }
  async function copy() {
    if (!code) return;
    try {
      await navigator.clipboard?.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  }

  return (
    <section className="card p-5 space-y-3">
      <h3 className="font-bold">Join code</h3>
      {code ? (
        <div className="flex flex-wrap items-center gap-3">
          <code
            className="px-3 py-1.5 rounded-lg font-mono text-lg tracking-widest"
            style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
          >
            {code}
          </code>
          <button type="button" className="btn" onClick={copy}>
            {copied ? "Copied!" : "Copy code"}
          </button>
          <button type="button" className="btn" onClick={rotate} disabled={busy}>
            Rotate
          </button>
          <button type="button" className="btn" onClick={disable} disabled={busy}>
            Disable joining
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <p className="muted text-sm">Joining is disabled.</p>
          <button type="button" className="btn btn-primary" onClick={rotate} disabled={busy}>
            Generate code
          </button>
        </div>
      )}
      <p className="muted text-xs">Students enter this code on their Classes page to join.</p>
    </section>
  );
}

/* ── invite by email (invite-by-link; no mail infra) ── */

function InviteByEmail({ id, invites }: { id: string; invites: TeacherInvite[] }) {
  const [emails, setEmails] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedInvite[]>([]);
  const [warning, setWarning] = useState<string | null>(null);

  async function invite() {
    // Split on commas / whitespace / semicolons — however the teacher pasted them.
    const list = emails
      .split(/[\s,;]+/)
      .map((e) => e.trim())
      .filter(Boolean);
    if (list.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const res = await jsonFetch<CreateInvitesResult>(`/api/classes/${id}/invites`, {
        method: "POST",
        body: JSON.stringify({ emails: list }),
      });
      setCreated(res.invites);
      setWarning(res.warning ?? null);
      setEmails("");
      await mutate(classKey(id));
      await revalidateClasses();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't create the invites.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card p-5 space-y-3">
      <div>
        <h3 className="font-bold">Invite by email</h3>
        <p className="muted text-xs mt-1">
          Enter one or more emails. Lexi creates an invite and a private accept link for each — copy
          it and send it however you like (email, chat). No email is sent for you. A seat is only
          taken when someone accepts.
        </p>
      </div>
      <form
        className="flex flex-col sm:flex-row gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (emails.trim()) void invite();
        }}
      >
        <input
          className="input flex-1"
          placeholder="a@example.com, b@example.com"
          value={emails}
          autoComplete="off"
          onChange={(e) => setEmails(e.target.value)}
          aria-label="Emails to invite"
        />
        <button type="submit" className="btn btn-primary" disabled={busy || !emails.trim()}>
          {busy ? "Inviting…" : "Invite"}
        </button>
      </form>

      {error && (
        <p role="alert" className="text-sm" style={{ color: "var(--bad)" }}>
          {error}
        </p>
      )}
      {warning && (
        <p className="text-sm" style={{ color: "var(--warn)" }}>
          {warning}
        </p>
      )}

      {created.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-semibold">Accept links — copy and send to each person:</p>
          {created.map((inv) => (
            <AcceptLinkRow key={inv.id} invite={inv} />
          ))}
        </div>
      )}

      <div className="space-y-1">
        <p className="text-sm font-semibold">Pending invites</p>
        {invites.length === 0 ? (
          <p className="muted text-sm">No pending invites.</p>
        ) : (
          <ul className="space-y-1">
            {invites.map((inv) => (
              <PendingInviteRow key={inv.id} id={id} invite={inv} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function AcceptLinkRow({ invite }: { invite: CreatedInvite }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard?.writeText(invite.acceptLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="font-semibold">{invite.email}</span>
      <code
        className="px-2 py-1 rounded font-mono text-xs truncate max-w-full"
        style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
      >
        {invite.acceptLink}
      </code>
      <button type="button" className="btn" onClick={copy}>
        {copied ? "Copied!" : "Copy link"}
      </button>
    </div>
  );
}

function PendingInviteRow({ id, invite }: { id: string; invite: TeacherInvite }) {
  const [busy, setBusy] = useState(false);
  async function revoke() {
    setBusy(true);
    try {
      await jsonFetch(`/api/classes/${id}/invites/${invite.id}`, { method: "DELETE" });
      await mutate(classKey(id));
      await revalidateClasses();
    } catch {
      setBusy(false);
    }
  }
  return (
    <li className="flex items-center justify-between gap-2 text-sm">
      <span className="muted truncate">{invite.email}</span>
      <button
        type="button"
        className="btn"
        onClick={revoke}
        disabled={busy}
        aria-label={`Revoke invite for ${invite.email}`}
      >
        Revoke
      </button>
    </li>
  );
}

function EditClass({ id, cls }: { id: string; cls: ClassRow }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(cls.name);
  const [emoji, setEmoji] = useState(cls.emoji);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await jsonFetch(`/api/classes/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ name: name.trim(), emoji }),
      });
      await mutate(classKey(id));
      await revalidateClasses();
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className="btn" onClick={() => setOpen(true)}>
        Edit
      </button>
    );
  }
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "color-mix(in srgb, var(--ink) 45%, transparent)" }}
      role="dialog"
      aria-modal="true"
      aria-label="Edit class"
    >
      <form
        className="card p-6 w-full max-w-md space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) void save();
        }}
      >
        <h2 className="text-xl font-extrabold tracking-tight">Edit class</h2>
        <div className="space-y-2">
          <label htmlFor="edit-name" className="text-sm font-semibold">
            Class name
          </label>
          <input id="edit-name" className="input" value={name} onChange={(e) => setName(e.target.value)} />
          <label htmlFor="edit-emoji" className="text-sm font-semibold">
            Emoji
          </label>
          <input id="edit-emoji" className="input" value={emoji} onChange={(e) => setEmoji(e.target.value)} />
        </div>
        <div className="flex gap-2 justify-end">
          <button type="button" className="btn" onClick={() => setOpen(false)} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy || !name.trim()}>
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}

function ArchiveButton({ id, onArchived }: { id: string; onArchived: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  async function archive() {
    setBusy(true);
    try {
      await jsonFetch(`/api/classes/${id}`, { method: "DELETE" });
      await revalidateClasses();
      onArchived();
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

/* ── student ── */

function StudentView({ id, detail }: { id: string; detail: Extract<ClassDetail, { role: "student" }> }) {
  const router = useRouter();
  const [leaving, setLeaving] = useState(false);
  const cls = detail.class;

  async function leave() {
    setLeaving(true);
    try {
      await jsonFetch(`/api/classes/${id}/leave`, { method: "POST" });
      await revalidateClasses();
      router.push("/classes");
    } catch {
      setLeaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-3xl font-extrabold tracking-tight">
          {cls.emoji ? `${cls.emoji} ` : ""}
          {cls.name}
        </h1>
        <p className="muted mt-1">
          Teacher: {detail.teachers.map((t) => t.name).join(", ") || "—"}
          {detail.archived ? " · this class has been closed" : ""}
        </p>
      </section>

      <TrustCard
        teacherNames={detail.teachers.map((t) => t.name)}
        onLeave={detail.archived ? undefined : leave}
        leaving={leaving}
      />

      {!detail.archived && <StudentClassAssignments classId={id} />}

      <Link href="/classes" className="btn">
        ← Back to Classes
      </Link>
    </div>
  );
}
