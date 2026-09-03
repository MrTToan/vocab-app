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

/*
 * Never let the app-page HTML DOCUMENT be stored by the browser or a shared
 * cache. The shell references content-hashed JS chunks, so a STALE shell serves
 * STALE JS after a deploy — the class behind the "/practice Check stopped
 * working" reports (a cached page bundle, NOT a logic regression; mirrors #51's
 * stale-cache class, now the document itself). Next serves statically-rendered
 * app pages with `Cache-Control: s-maxage=31536000` by default, so a CDN
 * (Cloudflare) would pin the old shell — and its old chunk URLs — for up to a
 * year after a deploy. `no-store` forces a fresh shell every load; the chunks
 * stay `immutable`-cached because this proxy's matcher never runs on
 * /_next/static (or /api). Applied to every matched response (pass AND redirect)
 * and independent of auth, so a signed-out redirect isn't cached either. Mirrors
 * lib/api.ts MUTABLE_JSON_CACHE_HEADERS (`private, no-store`), for the document.
 */
const DOCUMENT_CACHE_CONTROL = "private, no-store";

export function proxy(request: NextRequest) {
  const res = guard(request);
  res.headers.set("Cache-Control", DOCUMENT_CACHE_CONTROL);
  return res;
}

/** Cookie-presence sign-in redirect (no DB lookup, no JWT decode). See the file
 *  header for why this stays this cheap. */
function guard(request: NextRequest): NextResponse {
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
