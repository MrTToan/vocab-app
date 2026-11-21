/*
 * Pure helpers for the signed-out → Google sign-in hand-off (landing CTAs and
 * the `/?signin=1` notice). No React, no Auth.js import, so they're unit-testable
 * and usable from both proxy.ts (edge) and client islands.
 *
 * The sign-in URL is Auth.js's own GET endpoint (`/api/auth/signin`), which
 * shows the Google button and, after consent, redirects to `callbackUrl`.
 * Auth.js's default `redirect` callback already refuses cross-origin callbacks;
 * `safeCallbackPath` is the belt-and-braces check on OUR side so a crafted
 * `/?signin=1&next=…` can never even put an off-site URL into the link.
 */

/** Where a signed-in visitor lands when there's no better destination. */
export const DEFAULT_CALLBACK = "/vocab";

/** Query param proxy.ts uses to carry the bounced deep link back to `/`. */
export const NEXT_PARAM = "next";

/** A same-origin, absolute PATH (`/vocab?x=1`), or `null`. Rejects
 *  protocol-relative (`//evil`), backslash tricks (`/\evil`), schemes, and
 *  anything not starting with a single `/`. */
export function safeCallbackPath(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== "string") return null;
  if (!raw.startsWith("/")) return null;
  if (raw.startsWith("//") || raw.startsWith("/\\")) return null;
  if (/[\u0000-\u001f\u007f]/.test(raw)) return null;
  return raw;
}

/** The Auth.js sign-in URL that returns to `callback` (a same-origin path)
 *  after Google consent. Falls back to DEFAULT_CALLBACK for unsafe input. */
export function signInHref(callback: string | null | undefined = DEFAULT_CALLBACK): string {
  const path = safeCallbackPath(callback) ?? DEFAULT_CALLBACK;
  return `/api/auth/signin?callbackUrl=${encodeURIComponent(path)}`;
}

/** The landing URL proxy.ts bounces a signed-out deep link to. Keeps the
 *  original path (+ query) so the notice's button can return there. */
export function signInBouncePath(pathWithSearch: string): string {
  const path = safeCallbackPath(pathWithSearch);
  return path ? `/?signin=1&${NEXT_PARAM}=${encodeURIComponent(path)}` : "/?signin=1";
}
