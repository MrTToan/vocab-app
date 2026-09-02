import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { get, post, oversized, crossOrigin, expectIssues } from "./kit";

/*
 * /api/feedback — the in-app feedback widget's submit (POST, any signed-in user)
 * and the admin list (GET, owner-only). Wrapper coverage (401/403/413/400) plus
 * the write + the newest-first admin read. Real temp SQLite; only currentUserId
 * is stubbed so the owner check (resolveIsOwner) runs for real ("local-user" is
 * always the owner).
 */

const caller = vi.hoisted(() => ({ id: "user-a" as string | null }));
vi.mock("@/lib/auth/user", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/auth/user")>();
  return { ...real, currentUserId: async () => caller.id };
});

let route: typeof import("@/app/api/feedback/route");

const OWNER = "local-user";
const url = "http://t/api/feedback";

beforeAll(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "lexi-feedback-"));
  process.env.DATABASE_URL = `file:${path.join(dir, "t.db")}`;
  delete process.env.DATABASE_AUTH_TOKEN;
  delete process.env.SHEET_ID;
  route = await import("@/app/api/feedback/route");
});

beforeEach(() => {
  caller.id = "user-a";
});

describe("signed out -> 401", () => {
  it.each([
    ["POST", () => route.POST(post(url, { message: "hi" }))],
    ["GET", () => route.GET(get(url))],
  ])("%s", async (_n, call) => {
    caller.id = null;
    const res = await call();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });
});

describe("wrapper gates", () => {
  it("cross-origin POST -> 403", async () => {
    const res = await route.POST(crossOrigin(url, "POST", { message: "hi" }));
    expect(res.status).toBe(403);
  });

  it("oversized POST -> 413", async () => {
    expect((await route.POST(oversized(url))).status).toBe(413);
  });

  it.each([
    ["empty message", { message: "   " }],
    ["missing message", { category: "bug" }],
    ["message too long", { message: "x".repeat(4001) }],
    ["bad category", { category: "praise", message: "hi" }],
    ["rating out of range", { message: "hi", rating: 9 }],
    ["unknown key (strict)", { message: "hi", evil: 1 }],
  ])("400 {error, issues}: %s", async (_n, body) => {
    await expectIssues(await route.POST(post(url, body)));
  });
});

describe("GET is owner-only", () => {
  it("403 for a signed-in non-owner", async () => {
    caller.id = "user-a";
    expect((await route.GET(get(url))).status).toBe(403);
  });
});

describe("submit + admin list", () => {
  it("stores a submission (category default, optional rating) and lists it newest-first for the owner", async () => {
    // user-a submits with only a message → category defaults to "other", no rating.
    caller.id = "user-a";
    const r1 = await route.POST(
      post(url, { message: "The practice page is great!", page: "/practice" }, { "user-agent": "vitest-UA" }),
    );
    expect(r1.status).toBe(200);
    expect(await r1.json()).toEqual({ ok: true });

    // user-b submits a bug with a rating a moment later (newer).
    caller.id = "user-b";
    await new Promise((res) => setTimeout(res, 5));
    const r2 = await route.POST(post(url, { category: "bug", rating: 2, message: "Found a typo" }));
    expect(r2.status).toBe(200);

    // The owner reads every submission, newest first.
    caller.id = OWNER;
    const res = await route.GET(get(url));
    expect(res.status).toBe(200);
    const { feedback } = (await res.json()) as {
      feedback: Array<{
        category: string;
        rating: number | null;
        message: string;
        page: string;
        user_agent: string;
        user_id: string;
      }>;
    };
    expect(feedback.length).toBe(2);

    // Newest first.
    expect(feedback[0].message).toBe("Found a typo");
    expect(feedback[0].category).toBe("bug");
    expect(feedback[0].rating).toBe(2);
    expect(feedback[0].user_id).toBe("user-b");

    const older = feedback[1];
    expect(older.message).toBe("The practice page is great!");
    expect(older.category).toBe("other"); // defaulted
    expect(older.rating).toBe(null); // optional, unset
    expect(older.page).toBe("/practice");
    expect(older.user_agent).toBe("vitest-UA"); // captured server-side
    expect(older.user_id).toBe("user-a");
  });
});
