import { describe, it, expect, beforeAll, vi } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { get } from "./kit";

/*
 * CLASS-level guard — mutable per-user JSON GETs must NOT ship a browser cache
 * that can serve a stale response to SWR's post-mutation revalidation. That is
 * the root cause of the "click succeeds server-side but the UI never updates"
 * bug class: `/api/collections` (make-public/private, rename, delete, adopt) and
 * `/api/config` (the owner's admin LLM toggle) once sent
 * `max-age=30, stale-while-revalidate=300`, so a refetch after a write was
 * answered from the browser HTTP cache with the OLD body for up to 30s.
 *
 * This asserts every such endpoint sends `no-store` (no positive max-age /
 * s-maxage / stale-while-revalidate). Adding a new mutable-data GET with a
 * caching header will fail here — reach for MUTABLE_JSON_CACHE_HEADERS instead.
 */

// A signed-in OWNER, so the config route returns its full (owner-only) body too.
const caller = vi.hoisted(() => ({ id: "local-user" as string | null }));
vi.mock("@/lib/auth/user", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/auth/user")>();
  return { ...real, currentUserId: async () => caller.id };
});

let collections: typeof import("@/app/api/collections/route");
let config: typeof import("@/app/api/config/route");

beforeAll(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "lexi-cache-"));
  process.env.DATABASE_URL = `file:${path.join(dir, "t.db")}`;
  delete process.env.DATABASE_AUTH_TOKEN;
  delete process.env.SHEET_ID;
  collections = await import("@/app/api/collections/route");
  config = await import("@/app/api/config/route");
});

/** True when a Cache-Control value would let the browser reuse a stored
 *  response WITHOUT revalidating — i.e. it can mask a fresh mutation. */
function permitsStaleReuse(cc: string | null): boolean {
  if (!cc) return false;
  const v = cc.toLowerCase();
  if (v.includes("no-store")) return false;
  return /(?:^|[\s,])(?:max-age|s-maxage)\s*=\s*(\d+)/.test(v)
    ? Number(RegExp.$1) > 0
    : /stale-while-revalidate/.test(v);
}

describe("mutable-data GET endpoints don't ship a masking cache header", () => {
  const cases: Array<[string, () => Promise<Response>]> = [
    ["GET /api/collections", () => collections.GET(get("http://t/api/collections"))],
    ["GET /api/config", () => config.GET(get("http://t/api/config"))],
  ];

  it.each(cases)("%s → Cache-Control cannot serve stale", async (_name, call) => {
    const res = await call();
    expect(res.status).toBe(200);
    const cc = res.headers.get("cache-control");
    expect(cc).toBeTruthy();
    expect(cc!.toLowerCase()).toContain("no-store");
    expect(permitsStaleReuse(cc)).toBe(false);
  });
});
