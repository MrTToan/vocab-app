import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";

/*
 * Stale-shell guard. Next serves statically-rendered app pages with
 * `Cache-Control: s-maxage=31536000`, so a CDN pins the old HTML shell — and its
 * old content-hashed chunk URLs — for up to a year after a deploy, serving STALE
 * JS (the class behind the recurring "/practice Check stopped working" reports).
 * The proxy must stamp `private, no-store` on every matched app-document response
 * so a fresh shell is always fetched. These fail pre-fix (proxy set no
 * Cache-Control) and pass post-fix.
 */

function req(path: string, cookie?: string): NextRequest {
  return new NextRequest(new URL(`http://localhost${path}`), {
    headers: cookie ? { cookie } : undefined,
  });
}

const SAVED = { id: process.env.AUTH_GOOGLE_ID, secret: process.env.AUTH_SECRET };

beforeEach(() => {
  delete process.env.AUTH_GOOGLE_ID;
  delete process.env.AUTH_SECRET;
});
afterEach(() => {
  if (SAVED.id === undefined) delete process.env.AUTH_GOOGLE_ID;
  else process.env.AUTH_GOOGLE_ID = SAVED.id;
  if (SAVED.secret === undefined) delete process.env.AUTH_SECRET;
  else process.env.AUTH_SECRET = SAVED.secret;
});

describe("proxy — app documents are never cached (stale-shell guard)", () => {
  it("stamps no-store on the pass-through (dev seam: no auth configured)", () => {
    const res = proxy(req("/practice"));
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    // pass-through, not a redirect
    expect(res.headers.get("location")).toBeNull();
  });

  it("keeps no-store for a signed-in request (auth configured + session cookie)", () => {
    process.env.AUTH_GOOGLE_ID = "id";
    process.env.AUTH_SECRET = "secret";
    const res = proxy(req("/vocab", "authjs.session-token=abc"));
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("location")).toBeNull();
  });

  it("redirects a signed-out visitor to sign in AND still no-stores the redirect", () => {
    process.env.AUTH_GOOGLE_ID = "id";
    process.env.AUTH_SECRET = "secret";
    const res = proxy(req("/practice"));
    expect(res.headers.get("location")).toContain("/?signin=1");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });
});
