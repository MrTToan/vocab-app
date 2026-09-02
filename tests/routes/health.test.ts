import { describe, it, expect, vi } from "vitest";

/*
 * /api/health is the container healthcheck: public (no auth stub), 200 when the
 * DB answers, 503 when the shared DB module fails.
 */

const dbState = vi.hoisted(() => ({ fail: false }));
vi.mock("@/lib/db", () => ({
  getDb: async () => {
    if (dbState.fail) throw new Error("boom");
    return { execute: async () => ({ rows: [] }) };
  },
}));

describe("GET /api/health", () => {
  it("200 {ok:true} without auth", async () => {
    const { GET } = await import("@/app/api/health/route");
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ ok: true });
  });

  it("503 {ok:false} when the DB throws", async () => {
    dbState.fail = true;
    const { GET } = await import("@/app/api/health/route");
    const res = await GET();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false });
  });
});
