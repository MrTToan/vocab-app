import { NextResponse, type NextRequest } from "next/server";

/*
 * Sign-in guard (Next 16 renamed `middleware` → `proxy`; see
 * node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md).
 *
 * A signed-out visitor who opens an app page used to get the full shell with
 * every data panel showing "unauthorized" errors. Instead, when real auth is
 * configured, bounce requests without a session cookie to the landing page,
 * which shows a "Please sign in to continue" note (?signin=1).
 *
 * COOKIE PRESENCE ONLY — no DB lookup, no JWT decode. This is a UX redirect,
 * not enforcement: a forged cookie just reaches pages whose API calls still
 * 401 (route handlers remain the real gate via currentUserId()). Keeping it
 * this cheap is what lets the (app) layout stay synchronous — do NOT be
 * tempted to `auth()` here or in the layout (see the nav-speed rationale in
 * app/(app)/layout.tsx and tests/nav-loading.test.ts).
 *
 * API routes are deliberately NOT matched — they keep returning 401 JSON.
 */

const SESSION_COOKIES = ["authjs.session-token", "__Secure-authjs.session-token"];

export function proxy(request: NextRequest) {
  // Dev seam: with no Google/Auth.js credentials configured the app runs as
  // the local owner (see lib/auth/user.ts) — nothing to guard.
  const authConfigured = !!process.env.AUTH_GOOGLE_ID && !!process.env.AUTH_SECRET;
  if (!authConfigured) return NextResponse.next();

  if (SESSION_COOKIES.some((name) => request.cookies.has(name))) {
    return NextResponse.next();
  }

  return NextResponse.redirect(new URL("/?signin=1", request.url));
}

// The signed-in app surface. `:path*` is zero-or-more segments, so `/writing`
// AND `/writing/task1` both match. Marketing pages (/, /how-it-works, /privacy,
// /terms), /api and static assets are not listed, so the proxy never runs there.
export const config = {
  matcher: [
    "/vocab/:path*",
    "/practice/:path*",
    "/library/:path*",
    "/add/:path*",
    "/report/:path*",
    "/writing/:path*",
    "/admin/:path*",
    "/collections/:path*",
    "/progress/:path*",
    "/import/:path*",
  ],
};
