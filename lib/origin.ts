/*
 * Canonical public origin for building user-facing absolute links (e.g. class
 * invite accept links).
 *
 * Behind a reverse proxy (Caddy → the Next container on localhost:3000) the
 * raw `req.url` is the INTERNAL address, so `new URL(req.url).origin` yields
 * `http(s)://localhost:3000` — a dead link for real users. Prefer, in order:
 *
 *   1. The configured canonical URL (NextAuth v5's `AUTH_URL`, aliased by the
 *      legacy `NEXTAUTH_URL`). Not spoofable; if auth works in prod this is set.
 *   2. The proxy's forwarded headers (`x-forwarded-proto` + `x-forwarded-host`,
 *      falling back to `host`). The app already trusts the proxy for auth CSRF.
 *   3. The raw request origin — keeps local dev working, where the request IS
 *      the origin.
 */
export function publicOrigin(req: Request): string {
  // 1. Configured canonical URL (most reliable, not spoofable).
  const configured = process.env.AUTH_URL ?? process.env.NEXTAUTH_URL;
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      // fall through on a malformed env value
    }
  }

  // 2. Proxy-forwarded headers.
  const fwdHost = req.headers.get("x-forwarded-host");
  const host = (fwdHost ? fwdHost.split(",")[0] : req.headers.get("host"))?.trim();
  if (host) {
    const fwdProto = req.headers.get("x-forwarded-proto");
    const proto = (fwdProto ? fwdProto.split(",")[0] : null)?.trim() || "https";
    return `${proto}://${host}`;
  }

  // 3. Fall back to the raw request origin (local dev).
  return new URL(req.url).origin;
}
