import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { publicOrigin } from "@/lib/origin";

/*
 * publicOrigin(req): the canonical public origin for user-facing absolute links
 * (class invite accept links). Behind Caddy the raw `req.url` is the internal
 * localhost address, so we must prefer the configured canonical URL, then the
 * proxy-forwarded headers, and only fall back to the request origin in dev.
 */
describe("publicOrigin", () => {
  const AUTH_URL = process.env.AUTH_URL;
  const NEXTAUTH_URL = process.env.NEXTAUTH_URL;
  beforeEach(() => {
    delete process.env.AUTH_URL;
    delete process.env.NEXTAUTH_URL;
  });
  afterEach(() => {
    if (AUTH_URL === undefined) delete process.env.AUTH_URL;
    else process.env.AUTH_URL = AUTH_URL;
    if (NEXTAUTH_URL === undefined) delete process.env.NEXTAUTH_URL;
    else process.env.NEXTAUTH_URL = NEXTAUTH_URL;
  });

  const reqWith = (url: string, headers: Record<string, string> = {}) =>
    new Request(url, { headers });

  it("prefers the configured AUTH_URL over the raw request origin", () => {
    process.env.AUTH_URL = "https://lexi.vnfriends.com";
    const req = reqWith("http://localhost:3000/api/classes/x/invites");
    expect(publicOrigin(req)).toBe("https://lexi.vnfriends.com");
  });

  it("uses AUTH_URL's origin even when it carries a path", () => {
    process.env.AUTH_URL = "https://lexi.vnfriends.com/api/auth";
    const req = reqWith("http://localhost:3000/x");
    expect(publicOrigin(req)).toBe("https://lexi.vnfriends.com");
  });

  it("falls back to NEXTAUTH_URL when AUTH_URL is unset", () => {
    process.env.NEXTAUTH_URL = "https://lexi.vnfriends.com";
    const req = reqWith("http://localhost:3000/x");
    expect(publicOrigin(req)).toBe("https://lexi.vnfriends.com");
  });

  it("derives from x-forwarded-host + x-forwarded-proto when no env is set", () => {
    const req = reqWith("http://localhost:3000/x", {
      "x-forwarded-host": "lexi.vnfriends.com",
      "x-forwarded-proto": "https",
    });
    expect(publicOrigin(req)).toBe("https://lexi.vnfriends.com");
  });

  it("takes the first value of a comma-joined forwarded chain and defaults proto to https", () => {
    const req = reqWith("http://localhost:3000/x", {
      "x-forwarded-host": "lexi.vnfriends.com, internal:3000",
    });
    expect(publicOrigin(req)).toBe("https://lexi.vnfriends.com");
  });

  it("falls back to the plain host header when no forwarded host is present", () => {
    const req = reqWith("http://localhost:3000/x", { host: "example.test" });
    expect(publicOrigin(req)).toBe("https://example.test");
  });

  it("falls back to the raw request origin in local dev (no env, no proxy headers)", () => {
    const req = reqWith("http://localhost:3000/api/classes/x/invites");
    expect(publicOrigin(req)).toBe("http://localhost:3000");
  });

  it("ignores a malformed AUTH_URL and falls through", () => {
    process.env.AUTH_URL = "not a url";
    const req = reqWith("http://localhost:3000/x", {
      "x-forwarded-host": "lexi.vnfriends.com",
      "x-forwarded-proto": "https",
    });
    expect(publicOrigin(req)).toBe("https://lexi.vnfriends.com");
  });
});
