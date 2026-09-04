"use client";

import { useEffect, useState } from "react";
import type { PendingInvite } from "@/lib/classes/types";
import ConsentDialog from "./ConsentDialog";

/*
 * The hub invite banner (design report §5.1). For each pending email invite
 * addressed to the caller, it names the teacher + class and states plainly what
 * joining shares, with [Accept] / [Decline]. Accept ALWAYS routes through the
 * SAME consent screen (ConsentDialog) as the code-join before any write — an
 * invite is never silently auto-accepted. When the user arrives from an accept
 * link (`/classes?invite=<token>`), `autoOpenToken` opens the matching invite's
 * consent on mount, so the link lands directly on the consent moment.
 *
 * Data + persistence live in the hub page; this component is pure UI over the
 * `invites` prop and the accept/decline callbacks, so it renders under test with
 * no network.
 */
export default function InviteBanner({
  invites,
  onAccept,
  onDecline,
  autoOpenToken = null,
}: {
  invites: PendingInvite[];
  onAccept: (invite: PendingInvite) => Promise<void>;
  onDecline: (invite: PendingInvite) => Promise<void>;
  autoOpenToken?: string | null;
}) {
  const [consentFor, setConsentFor] = useState<PendingInvite | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Arriving from an accept link: open the matching invite's consent screen.
  useEffect(() => {
    if (!autoOpenToken) return;
    const match = invites.find((i) => i.token && i.token === autoOpenToken);
    if (match) setConsentFor(match);
  }, [autoOpenToken, invites]);

  if (invites.length === 0) return null;

  async function accept(invite: PendingInvite) {
    setBusyId(invite.id);
    setError(null);
    try {
      await onAccept(invite);
      setConsentFor(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't join.");
    } finally {
      setBusyId(null);
    }
  }

  async function decline(invite: PendingInvite) {
    setBusyId(invite.id);
    setError(null);
    try {
      await onDecline(invite);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't decline.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="space-y-3" aria-label="Class invitations">
      <h2 className="text-xl font-bold flex items-center gap-2">
        <span aria-hidden>⚠</span> You&rsquo;ve been invited
      </h2>
      <div className="space-y-3">
        {invites.map((invite) => (
          <div
            key={invite.id}
            className="card p-4 flex flex-wrap items-center justify-between gap-3"
            style={{ background: "var(--accent-soft)" }}
          >
            <div className="min-w-0">
              <div className="font-semibold">
                {invite.teacher.name} invited you to {invite.class.emoji ? `${invite.class.emoji} ` : ""}
                &ldquo;{invite.class.name}&rdquo;
              </div>
              <p className="muted text-sm mt-0.5">
                Joining lets {invite.teacher.name} see your full Lexi report.
              </p>
            </div>
            <div className="flex gap-2 shrink-0">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setConsentFor(invite)}
                disabled={busyId === invite.id}
              >
                Accept
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => void decline(invite)}
                disabled={busyId === invite.id}
              >
                Decline
              </button>
            </div>
          </div>
        ))}
      </div>

      {error && !consentFor && (
        <p role="alert" className="text-sm" style={{ color: "var(--bad)" }}>
          {error}
        </p>
      )}

      {consentFor && (
        <ConsentDialog
          name={consentFor.class.name}
          emoji={consentFor.class.emoji}
          teacherName={consentFor.teacher.name}
          busy={busyId === consentFor.id}
          error={error}
          onCancel={() => {
            setConsentFor(null);
            setError(null);
          }}
          onConfirm={() => void accept(consentFor)}
        />
      )}
    </section>
  );
}
