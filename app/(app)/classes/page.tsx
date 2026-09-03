"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { jsonFetch } from "@/lib/ui";
import { useMyClasses, revalidateClasses } from "@/lib/swr";
import type { ClassRow, JoinPreview } from "@/lib/classes/types";
import ConsentDialog from "@/components/classes/ConsentDialog";

/*
 * The /classes hub — create/teach a class, or join one by code. Any signed-in
 * user can do both (not owner-gated). Joining ALWAYS goes through the shared
 * consent screen (ConsentDialog) before the write, per the privacy design.
 */
export default function ClassesHubPage() {
  const router = useRouter();
  const { data, isLoading, mutate } = useMyClasses();

  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-3xl font-extrabold tracking-tight">Classes</h1>
        <p className="muted mt-1">Teach a class, or join one your teacher shared.</p>
      </section>

      <JoinBox onJoined={() => revalidateClasses()} router={router} />

      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-xl font-bold">Classes I teach</h2>
          <CreateClass onCreated={(id) => router.push(`/classes/${id}`)} onMutated={() => mutate()} />
        </div>
        {isLoading ? (
          <p className="muted text-sm">Loading…</p>
        ) : data && data.teaching.length > 0 ? (
          <div className="grid sm:grid-cols-2 gap-3">
            {data.teaching.map((c) => (
              <Link key={c.id} href={`/classes/${c.id}`} className="card p-4 hover:opacity-90 transition-opacity">
                <div className="font-bold truncate">
                  {c.emoji ? `${c.emoji} ` : ""}
                  {c.name}
                </div>
                <div className="muted text-sm mt-1">
                  {c.studentCount} {c.studentCount === 1 ? "student" : "students"}
                  {c.join_code ? " · code active" : " · join disabled"}
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <p className="muted text-sm">You don&rsquo;t teach any classes yet. Create one to get a join code.</p>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-bold">Classes I&rsquo;m in</h2>
        {data && data.enrolled.length > 0 ? (
          <div className="grid sm:grid-cols-2 gap-3">
            {data.enrolled.map((c) => (
              <Link key={c.id} href={`/classes/${c.id}`} className="card p-4 hover:opacity-90 transition-opacity">
                <div className="font-bold truncate">
                  {c.emoji ? `${c.emoji} ` : ""}
                  {c.name}
                </div>
                <div className="muted text-sm mt-1">
                  Teacher: {c.teacherNames.join(", ") || "—"}
                </div>
                <div className="text-xs mt-2 inline-flex items-center gap-1" style={{ color: "var(--accent)" }}>
                  <span aria-hidden>●</span> can see my report
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <p className="muted text-sm">You haven&rsquo;t joined any classes. Enter a class code above to join one.</p>
        )}
      </section>
    </div>
  );
}

/* ── join by code (with the consent gate) ── */

function JoinBox({ onJoined, router }: { onJoined: () => void; router: ReturnType<typeof useRouter> }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<JoinPreview | null>(null);
  const [busy, setBusy] = useState(false);

  async function openConsent() {
    setError(null);
    setBusy(true);
    try {
      const p = await jsonFetch<JoinPreview>(`/api/classes/join?code=${encodeURIComponent(code.trim())}`);
      setPreview(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : "That code didn't work.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmJoin() {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      const { class: cls } = await jsonFetch<{ class: ClassRow; status: string }>("/api/classes/join", {
        method: "POST",
        body: JSON.stringify({ code: code.trim() }),
      });
      await onJoined();
      setPreview(null);
      setCode("");
      router.push(`/classes/${cls.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't join.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card p-4 space-y-2">
      <label htmlFor="join-code" className="font-bold text-sm">
        Join a class
      </label>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (code.trim()) void openConsent();
        }}
      >
        <input
          id="join-code"
          className="input flex-1"
          placeholder="enter class code"
          value={code}
          autoComplete="off"
          onChange={(e) => setCode(e.target.value)}
        />
        <button type="submit" className="btn btn-primary" disabled={busy || !code.trim()}>
          Join →
        </button>
      </form>
      {error && !preview && (
        <p role="alert" className="text-sm" style={{ color: "var(--bad)" }}>
          {error}
        </p>
      )}
      {preview && (
        <ConsentDialog
          name={preview.class.name}
          emoji={preview.class.emoji}
          teacherName={preview.teacher.name}
          busy={busy}
          error={error}
          onCancel={() => {
            setPreview(null);
            setError(null);
          }}
          onConfirm={confirmJoin}
        />
      )}
    </section>
  );
}

/* ── create a class ── */

function CreateClass({ onCreated, onMutated }: { onCreated: (id: string) => void; onMutated: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const { class: cls } = await jsonFetch<{ class: ClassRow }>("/api/classes", {
        method: "POST",
        body: JSON.stringify({ name: name.trim(), emoji: emoji.trim() || undefined }),
      });
      await revalidateClasses();
      onMutated();
      onCreated(cls.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't create the class.");
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
        + Create class
      </button>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "color-mix(in srgb, var(--ink) 45%, transparent)" }}
      role="dialog"
      aria-modal="true"
      aria-label="Create a class"
    >
      <form
        className="card p-6 w-full max-w-md space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) void create();
        }}
      >
        <h2 className="text-xl font-extrabold tracking-tight">Create a class</h2>
        <div className="space-y-2">
          <label htmlFor="class-name" className="text-sm font-semibold">
            Class name
          </label>
          <input
            id="class-name"
            className="input"
            placeholder="e.g. IELTS Evening"
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
          />
          <label htmlFor="class-emoji" className="text-sm font-semibold">
            Emoji (optional)
          </label>
          <input
            id="class-emoji"
            className="input"
            placeholder="📗"
            value={emoji}
            onChange={(e) => setEmoji(e.target.value)}
          />
        </div>
        {error && (
          <p role="alert" className="text-sm" style={{ color: "var(--bad)" }}>
            {error}
          </p>
        )}
        <div className="flex gap-2 justify-end">
          <button type="button" className="btn" onClick={() => setOpen(false)} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy || !name.trim()}>
            {busy ? "Creating…" : "Create"}
          </button>
        </div>
      </form>
    </div>
  );
}
