import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { get, post, oversized, crossOrigin, expectIssues } from "./kit";

/*
 * Wrapper coverage for /api/stats, /api/config, /api/questions/pending and the
 * two owner-only endpoints /api/questions/import and /api/admin/stats.
 */

const caller = vi.hoisted(() => ({ id: "user-a" as string | null }));
vi.mock("@/lib/auth/user", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/auth/user")>();
  return { ...real, currentUserId: async () => caller.id };
});

let stats: typeof import("@/app/api/stats/route");
let config: typeof import("@/app/api/config/route");
let pending: typeof import("@/app/api/questions/pending/route");
let qImport: typeof import("@/app/api/questions/import/route");
let admin: typeof import("@/app/api/admin/stats/route");

const question = { word_id: "w1", type: "cloze", payload: "A ____ sat.", answer: "cat" };

beforeAll(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "lexi-misc-"));
  process.env.DATABASE_URL = `file:${path.join(dir, "t.db")}`;
  delete process.env.DATABASE_AUTH_TOKEN;
  delete process.env.SHEET_ID;
  stats = await import("@/app/api/stats/route");
  config = await import("@/app/api/config/route");
  pending = await import("@/app/api/questions/pending/route");
  qImport = await import("@/app/api/questions/import/route");
  admin = await import("@/app/api/admin/stats/route");
});

beforeEach(() => {
  caller.id = "user-a";
});

describe("wrapper gates", () => {
  it.each([
    ["GET /api/stats", () => stats.GET(get("http://t/api/stats"))],
    ["GET /api/config", () => config.GET(get("http://t/api/config"))],
    ["GET /api/questions/pending", () => pending.GET(get("http://t/api/questions/pending"))],
    ["POST /api/questions/import", () => qImport.POST(post("http://t/api/questions/import", { questions: [question] }))],
    ["GET /api/admin/stats", () => admin.GET(get("http://t/api/admin/stats"))],
  ])("signed out %s -> 401", async (_n, call) => {
    caller.id = null;
    const res = await call();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  it("owner-only routes -> 403 for a signed-in non-owner", async () => {
    caller.id = "user-a";
    const imp = await qImport.POST(post("http://t/api/questions/import", { questions: [question] }));
    expect(imp.status).toBe(403);
    expect(await imp.json()).toEqual({ error: "forbidden" });
    const adm = await admin.GET(get("http://t/api/admin/stats"));
    expect(adm.status).toBe(403);
    expect(await adm.json()).toEqual({ error: "forbidden" });
  });

  it.each([
    ["GET /api/stats with a stray param", () => stats.GET(get("http://t/api/stats?bogus=1"))],
    ["GET /api/config with a stray param", () => config.GET(get("http://t/api/config?debug=1"))],
    ["GET /api/questions/pending with a stray param", () => pending.GET(get("http://t/api/questions/pending?x=1"))],
  ])("%s -> 400 {error, issues}", async (_n, call) => {
    await expectIssues(await call());
  });

  it("questions/import validation (owner): empty list, bad type, unknown key -> 400", async () => {
    caller.id = "local-user";
    await expectIssues(await qImport.POST(post("http://t/api/questions/import", { questions: [] })));
    await expectIssues(
      await qImport.POST(post("http://t/api/questions/import", { questions: [{ ...question, type: "essay" }] })),
    );
    await expectIssues(
      await qImport.POST(post("http://t/api/questions/import", { questions: [{ ...question, sneaky: 1 }] })),
    );
  });

  it("questions/import: cross-origin -> 403, oversized (>2 MB) -> 413", async () => {
    caller.id = "local-user";
    expect(
      (await qImport.POST(crossOrigin("http://t/api/questions/import", "POST", { questions: [question] }))).status,
    ).toBe(403);
    expect(
      (await qImport.POST(oversized("http://t/api/questions/import", "POST", 2 * 1024 * 1024 + 64))).status,
    ).toBe(413);
  });
});

describe("happy paths (temp SQLite)", () => {
  it("GET /api/stats returns the aggregate shape", async () => {
    const res = await stats.GET(get("http://t/api/stats"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.words.total).toBe("number");
    expect(body.attempts.byDay).toHaveLength(14);
  });

  it("GET /api/config: non-owner gets the minimal view, owner the diagnostics", async () => {
    const user = await (await config.GET(get("http://t/api/config"))).json();
    expect(user.owner).toBe(false);
    expect(user).not.toHaveProperty("backend");

    caller.id = "local-user";
    const owner = await (await config.GET(get("http://t/api/config"))).json();
    expect(owner.owner).toBe(true);
    expect(owner.backend).toBe("sqlite");
  });

  it("GET /api/questions/pending lists words without bank questions", async () => {
    const res = await pending.GET(get("http://t/api/questions/pending"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.count).toBe("number");
    expect(typeof body.totalQuestions).toBe("number");
  });

  it("POST /api/questions/import works for the owner", async () => {
    caller.id = "local-user";
    const res = await qImport.POST(post("http://t/api/questions/import", { questions: [question] }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ added: 1 });
  });

  it("GET /api/admin/stats works for the owner", async () => {
    caller.id = "local-user";
    const res = await admin.GET(get("http://t/api/admin/stats"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("users");
    expect(body).toHaveProperty("llm");
  });
});
