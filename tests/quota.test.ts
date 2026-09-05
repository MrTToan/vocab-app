import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";

/*
 * Per-user LLM quota (lib/auth/quota.ts) against a fresh temp DB:
 *   - the reservation is ATOMIC: N parallel calls at cap-1 admit exactly one;
 *   - the in-memory burst throttle rejects the 13th call inside a minute;
 *   - the new tasks carry their documented defaults and env overrides.
 */

let q: typeof import("../lib/auth/quota");

beforeAll(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "lexi-quota-"));
  process.env.DATABASE_URL = `file:${path.join(dir, "q.db")}`;
  delete process.env.DATABASE_AUTH_TOKEN;
  q = await import("../lib/auth/quota");
});

beforeEach(() => q.resetBurst());

describe("reserveQuota is atomic", () => {
  it("admits exactly one of N parallel calls when one unit remains", async () => {
    process.env.QUOTA_ENRICH = "5";
    const user = "racer";
    for (let i = 0; i < 4; i++) await q.reserveQuota(user, "enrich"); // used 4/5
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, () => q.reserveQuota(user, "enrich")),
    );
    const ok = results.filter((r) => r.status === "fulfilled").length;
    const rejected = results.filter(
      (r) => r.status === "rejected" && r.reason instanceof q.QuotaError,
    ).length;
    expect(ok).toBe(1);
    expect(rejected).toBe(7);
    expect((await q.quotaStatus(user)).enrich).toEqual({ used: 5, cap: 5 });
  });

  it("keeps the owner exempt", async () => {
    process.env.QUOTA_ENRICH = "1";
    for (let i = 0; i < 3; i++) await q.reserveQuota("local-user", "enrich");
  });
});

describe("burst throttle", () => {
  it("rejects the 13th call inside one minute and recovers after it", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < q.BURST_PER_MINUTE; i++) {
      expect(q.takeBurstToken("bursty", t0 + i)).toBe(true);
    }
    expect(q.takeBurstToken("bursty", t0 + 500)).toBe(false);
    expect(q.takeBurstToken("someone-else", t0 + 500)).toBe(true); // per user
    expect(q.takeBurstToken("bursty", t0 + 60_001)).toBe(true); // window slid
  });

  it("surfaces as BurstError from reserveQuota (429-shaped)", async () => {
    process.env.QUOTA_SCORE = "1000";
    const user = "bursty-2";
    for (let i = 0; i < q.BURST_PER_MINUTE; i++) await q.reserveQuota(user, "score");
    await expect(q.reserveQuota(user, "score")).rejects.toBeInstanceOf(q.BurstError);
    expect(q.isRateLimitError(new q.BurstError())).toBe(true);
    expect(q.isRateLimitError(new Error("x"))).toBe(false);
  });

  it("does not apply to `generate` when burst is disabled", async () => {
    process.env.QUOTA_GENERATE = "1000";
    const user = "learner";
    for (let i = 0; i < q.BURST_PER_MINUTE + 5; i++) {
      await q.reserveQuota(user, "generate", { burst: false });
    }
  });
});

describe("task caps", () => {
  it("lists every metered task with its documented default", () => {
    for (const k of Object.keys(process.env)) if (k.startsWith("QUOTA_")) delete process.env[k];
    expect([...q.QUOTA_TASKS]).toEqual([
      "enrich", "score", "score-writing", "extract-chart", "discuss-writing", "generate",
      "speak", "pronounce",
    ]);
    expect(q.capFor("enrich")).toBe(150);
    expect(q.capFor("score")).toBe(300);
    expect(q.capFor("score-writing")).toBe(40);
    expect(q.capFor("extract-chart")).toBe(5);
    expect(q.capFor("discuss-writing")).toBe(30);
    expect(q.capFor("generate")).toBe(300);
    expect(q.capFor("speak")).toBe(200);
    expect(q.capFor("pronounce")).toBe(100);
  });

  it("honours the env overrides", () => {
    process.env.QUOTA_EXTRACT_CHART = "2";
    process.env.QUOTA_DISCUSS = "7";
    process.env.QUOTA_GENERATE = "99";
    expect(q.capFor("extract-chart")).toBe(2);
    expect(q.capFor("discuss-writing")).toBe(7);
    expect(q.capFor("generate")).toBe(99);
  });
});
