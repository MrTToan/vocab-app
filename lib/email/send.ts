/*
 * Transactional email — a tiny direct wrapper over the Resend HTTP API
 * (https://api.resend.com/emails), so no npm dependency is needed.
 *
 * Deliberately graceful: if RESEND_API_KEY is unset (local dev, tests) this is a
 * NO-OP that returns `{ status: "skipped" }` — callers must never crash or block
 * their own work because email is unconfigured or Resend is down. All send
 * outcomes (including network/HTTP errors) are returned, never thrown, so the
 * caller decides how to surface a soft failure.
 */

/** From address, e.g. `Lexi <invites@lexi.vnfriends.com>`. Configurable so a
 *  different verified domain can be used without a code change. */
export const DEFAULT_EMAIL_FROM = "Lexi <invites@lexi.vnfriends.com>";

export interface EmailMessage {
  to: string | string[];
  subject: string;
  html: string;
  text: string;
  /** Overrides EMAIL_FROM / the default for this one message. */
  from?: string;
}

export type EmailSendResult =
  | { status: "sent"; id?: string }
  /** RESEND_API_KEY unset — email is intentionally disabled (dev/tests). */
  | { status: "skipped" }
  /** Resend rejected the send or the network failed. Not thrown — surfaced. */
  | { status: "error"; error: string };

const RESEND_ENDPOINT = "https://api.resend.com/emails";

function fromAddress(override?: string): string {
  // `|| default` (not `??`) so a blank EMAIL_FROM falls back instead of sending
  // an empty From.
  return override || process.env.EMAIL_FROM || DEFAULT_EMAIL_FROM;
}

/**
 * Send one email via Resend. Returns the outcome instead of throwing; a `skipped`
 * result (no API key) is the normal, expected path in local dev and tests.
 */
export async function sendEmail(msg: EmailMessage): Promise<EmailSendResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.debug("[email] RESEND_API_KEY unset — skipping send (invite links still returned)");
    return { status: "skipped" };
  }

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromAddress(msg.from),
        to: Array.isArray(msg.to) ? msg.to : [msg.to],
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      const error = `Resend responded ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`;
      console.warn(`[email] send failed — ${error}`);
      return { status: "error", error };
    }

    const body = (await res.json().catch(() => null)) as { id?: string } | null;
    return { status: "sent", id: body?.id };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.warn(`[email] send threw — ${error}`);
    return { status: "error", error };
  }
}
