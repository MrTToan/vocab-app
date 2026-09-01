import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";

/*
 * Route-level gates on the LLM-calling endpoints, calling the exported handlers
 * with a plain Request. No model is ever reached: `@/lib/llm` and
 * `@/lib/providers` are stubbed. `currentUserId` is swapped per test between
 * null (signed out), the dev owner (quota-exempt) and a normal user (metered).
 */

let uid: string | null = "local-user";
vi.mock("@/lib/auth/user", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/auth/user")>();
  return { ...real, currentUserId: async () => uid };
});
const llmCalls = { enrich: 0, vision: 0, discuss: 0 };
vi.mock("@/lib/llm", () => ({
  hasProvider: () => true,
  hasAnyLLM: () => true,
  enrichWord: async () => {
    llmCalls.enrich++;
    return { enrichment: { vi_meaning: "x" }, spellingSuggestion: null };
  },
}));
vi.mock("@/lib/providers", () => ({
  hasProvider: () => true,
  callVisionStructured: async () => {
    llmCalls.vision++;
    return { chart_type: "bar", unit: "", overview: "", key_trends: [], series: [] };
  },
  callStructured: async () => {
    llmCalls.discuss++;
    return { reply: "ok" };
  },
}));
const submission = {
  id: "s1", prompt_id: "p1", task_type: "task2", text: "essay", word_count: 1,
  overall_band: 6, bands: { TR: { band: 6, comment: "fine" } }, priorities: [], corrections: [],
};
vi.mock("@/lib/writing/store", () => ({
  writingStore: {
    getSubmission: async () => submission,
    forUser: () => ({ getPrompt: async () => ({ id: "p1", prompt_text: "Discuss." }) }),
    listDiscussion: async () => [],
    addDiscussionMessages: async (_s: string, _c: string, msgs: unknown[]) => msgs,
  },
}));

const post = (body: unknown) =>
  new Request("http://test/api", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const png = (bytes: number) =>
  `data:image/png;base64,${Buffer.alloc(bytes, 1).toString("base64")}`;

let enrich: typeof import("@/app/api/enrich/route");
let chart: typeof import("@/app/api/writing/extract-chart/route");
let discuss: typeof import("@/app/api/writing/discuss/route");
let quota: typeof import("@/lib/auth/quota");

beforeAll(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "lexi-routes-"));
  process.env.DATABASE_URL = `file:${path.join(dir, "r.db")}`;
  delete process.env.DATABASE_AUTH_TOKEN;
  delete process.env.AUTH_SECRET;
  delete process.env.AUTH_GOOGLE_ID;
  delete process.env.AUTH_GOOGLE_SECRET;
  enrich = await import("@/app/api/enrich/route");
  chart = await import("@/app/api/writing/extract-chart/route");
  discuss = await import("@/app/api/writing/discuss/route");
  quota = await import("@/lib/auth/quota");
});

beforeEach(() => {
  uid = "local-user";
  quota.resetBurst();
  llmCalls.enrich = llmCalls.vision = llmCalls.discuss = 0;
});

describe("signed out -> 401, no model call", () => {
  it.each([
    ["/api/enrich", () => enrich.POST(post({ word: "cat" }))],
    ["/api/writing/extract-chart", () => chart.POST(post({ image: png(10) }))],
    ["/api/writing/discuss", () => discuss.POST(post({ submissionId: "s1", cardKey: "criterion:TR", message: "why?" }))],
  ])("%s", async (_name, call) => {
    uid = null;
    const res = await call();
    expect(res.status).toBe(401);
    expect(llmCalls).toEqual({ enrich: 0, vision: 0, discuss: 0 });
  });
});

describe("signed in (dev owner) -> the happy paths still work", () => {
  it("enrich returns a preview", async () => {
    const res = await enrich.POST(post({ word: "cat" }));
    expect(res.status).toBe(200);
    expect(llmCalls.enrich).toBe(1);
  });
  it("extract-chart accepts a small PNG", async () => {
    const res = await chart.POST(post({ image: png(1024) }));
    expect(res.status).toBe(200);
    expect(llmCalls.vision).toBe(1);
  });
  it("discuss answers a short question", async () => {
    const res = await discuss.POST(post({ submissionId: "s1", cardKey: "criterion:TR", message: "why?" }));
    expect(res.status).toBe(200);
    expect(llmCalls.discuss).toBe(1);
  });
});

describe("input validation -> 400, no model call", () => {
  it("extract-chart rejects a non-image MIME", async () => {
    const res = await chart.POST(post({ image: "data:text/html;base64,PGI+aGk8L2I+" }));
    expect(res.status).toBe(400);
    expect(llmCalls.vision).toBe(0);
  });
  it("extract-chart rejects an SVG (not in the allow-list)", async () => {
    const res = await chart.POST(post({ image: "data:image/svg+xml;base64,PHN2Zy8+" }));
    expect(res.status).toBe(400);
  });
  it("extract-chart rejects an image over 2 MB", async () => {
    const res = await chart.POST(post({ image: png(2 * 1024 * 1024 + 1) }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/too large/);
    expect(llmCalls.vision).toBe(0);
  });
  it("extract-chart accepts exactly 2 MB and JPEG/WebP", async () => {
    expect(chart.imageProblem(png(2 * 1024 * 1024))).toBeNull();
    expect(chart.imageProblem("data:image/jpeg;base64,AAAA")).toBeNull();
    expect(chart.imageProblem("data:image/webp;base64,AAAA")).toBeNull();
    expect(chart.imageProblem("data:image/png;base64,")).toMatch(/empty/);
  });
  it("discuss rejects a 1,001-character message", async () => {
    const res = await discuss.POST(
      post({ submissionId: "s1", cardKey: "criterion:TR", message: "a".repeat(1001) }),
    );
    expect(res.status).toBe(400);
    expect(llmCalls.discuss).toBe(0);
    const ok = await discuss.POST(
      post({ submissionId: "s1", cardKey: "criterion:TR", message: "a".repeat(1000) }),
    );
    expect(ok.status).toBe(200);
  });
});

describe("a normal user is metered", () => {
  it("extract-chart -> 429 once the daily cap is spent", async () => {
    uid = "user-chart";
    process.env.QUOTA_EXTRACT_CHART = "1";
    expect((await chart.POST(post({ image: png(64) }))).status).toBe(200);
    const res = await chart.POST(post({ image: png(64) }));
    expect(res.status).toBe(429);
    expect(llmCalls.vision).toBe(1);
  });
  it("enrich -> 429 once the daily cap is spent", async () => {
    uid = "user-enrich";
    process.env.QUOTA_ENRICH = "1";
    expect((await enrich.POST(post({ word: "cat" }))).status).toBe(200);
    expect((await enrich.POST(post({ word: "dog" }))).status).toBe(429);
  });
  it("discuss -> 429 once the daily cap is spent", async () => {
    uid = "user-discuss";
    process.env.QUOTA_DISCUSS = "1";
    const body = { submissionId: "s1", cardKey: "criterion:TR", message: "why?" };
    expect((await discuss.POST(post(body))).status).toBe(200);
    expect((await discuss.POST(post(body))).status).toBe(429);
  });
  it("the burst throttle is shared across routes -> 429 with a slow-down message", async () => {
    uid = "user-burst";
    process.env.QUOTA_ENRICH = "1000";
    process.env.QUOTA_DISCUSS = "1000";
    for (let i = 0; i < quota.BURST_PER_MINUTE - 1; i++) {
      expect((await enrich.POST(post({ word: "w" + i }))).status).toBe(200);
    }
    const body = { submissionId: "s1", cardKey: "criterion:TR", message: "why?" };
    expect((await discuss.POST(post(body))).status).toBe(200); // 12th call
    const res = await discuss.POST(post(body)); // 13th within the minute
    expect(res.status).toBe(429);
    expect(((await res.json()) as { error: string }).error).toMatch(/slow down/);
  });
});
