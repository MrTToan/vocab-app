/*
 * The class-invite email. Builds a small, honest transactional message — class
 * name, inviting teacher, the privacy note that joining shares the student's
 * whole Lexi report, and the accept link as a button + a plain-text fallback —
 * and hands it to the graceful Resend wrapper (`sendEmail`).
 *
 * Consistent with the in-app consent copy: joining shares the WHOLE Lexi report
 * with the teacher. Keep this wording in step with `TrustCard` / `/about` if the
 * consent copy changes.
 */
import { sendEmail, type EmailSendResult } from "./send";

/** Minimal HTML-escape for user-controlled text interpolated into the email. */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface InviteEmailParams {
  /** Recipient address (the invited email). */
  to: string;
  /** Class the student is being invited to. */
  className: string;
  /** Display name of the inviting teacher. */
  teacherName: string;
  /** The tokenised accept link (already built from the canonical public origin). */
  acceptLink: string;
  /** Override the From address (else EMAIL_FROM / the default). */
  from?: string;
}

const PRIVACY_NOTE =
  "Joining shares your whole Lexi report — your vocabulary progress and writing history — with this teacher, so they can help you. You can leave the class at any time to stop sharing.";

/** Build the invite email's subject/html/text (no I/O — testable on its own). */
export function buildInviteEmail(params: InviteEmailParams): {
  subject: string;
  html: string;
  text: string;
} {
  const { className, teacherName, acceptLink } = params;
  const subject = `${teacherName} invited you to “${className}” on Lexi`;

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1f2328;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f7f9;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;background:#ffffff;border-radius:12px;padding:32px;">
            <tr><td style="font-size:20px;font-weight:700;padding-bottom:8px;">You're invited to a class on Lexi</td></tr>
            <tr><td style="font-size:15px;line-height:1.5;padding-bottom:16px;">
              <strong>${esc(teacherName)}</strong> invited you to join <strong>${esc(className)}</strong>.
            </td></tr>
            <tr><td style="font-size:13px;line-height:1.5;color:#57606a;padding-bottom:24px;">
              ${esc(PRIVACY_NOTE)}
            </td></tr>
            <tr><td align="center" style="padding-bottom:20px;">
              <a href="${esc(acceptLink)}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 28px;border-radius:8px;">Review &amp; accept invite</a>
            </td></tr>
            <tr><td style="font-size:12px;line-height:1.5;color:#57606a;padding-bottom:4px;">
              Or paste this link into your browser:
            </td></tr>
            <tr><td style="font-size:12px;line-height:1.5;word-break:break-all;">
              <a href="${esc(acceptLink)}" style="color:#2563eb;">${esc(acceptLink)}</a>
            </td></tr>
          </table>
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;">
            <tr><td style="font-size:11px;color:#8b949e;padding:16px 32px;">
              If you weren't expecting this, you can safely ignore this email — no account is shared until you accept.
            </td></tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const text = [
    `${teacherName} invited you to join "${className}" on Lexi.`,
    "",
    PRIVACY_NOTE,
    "",
    "Review and accept your invite:",
    acceptLink,
    "",
    "If you weren't expecting this, you can safely ignore this email — no account is shared until you accept.",
  ].join("\n");

  return { subject, html, text };
}

/**
 * Send the class-invite email. Returns the send outcome (never throws): a
 * `skipped` result means email is not configured (dev/tests) and the caller
 * should fall back to the copyable link; an `error` result means the caller
 * should warn the teacher to share the link manually.
 */
export function sendInviteEmail(params: InviteEmailParams): Promise<EmailSendResult> {
  const { subject, html, text } = buildInviteEmail(params);
  return sendEmail({ to: params.to, subject, html, text, from: params.from });
}
