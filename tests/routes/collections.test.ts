import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { get, post, patch, del, oversized, crossOrigin, ctx, expectIssues } from "./kit";

/*
 * Wrapper coverage for the collection routes: /api/collections,
 * /api/collections/[id], /api/collections/[id]/members,
 * /api/collections/[id]/adopt. Real temp SQLite store.
 */

const caller = vi.hoisted(() => ({ id: "user-a" as string | null }));
vi.mock("@/lib/auth/user", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/auth/user")>();
  return { ...real, currentUserId: async () => caller.id };
});

let collections: typeof import("@/app/api/collections/route");
let byId: typeof import("@/app/api/collections/[id]/route");
let members: typeof import("@/app/api/collections/[id]/members/route");
let adopt: typeof import("@/app/api/collections/[id]/adopt/route");
let store: typeof import("@/lib/store");

beforeAll(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "lexi-colls-"));
  process.env.DATABASE_URL = `file:${path.join(dir, "t.db")}`;
  delete process.env.DATABASE_AUTH_TOKEN;
  delete process.env.SHEET_ID;
  collections = await import("@/app/api/collections/route");
  byId = await import("@/app/api/collections/[id]/route");
  members = await import("@/app/api/collections/[id]/members/route");
  adopt = await import("@/app/api/collections/[id]/adopt/route");
  store = await import("@/lib/store");
});

beforeEach(() => {
  caller.id = "user-a";
});

describe("signed out -> 401 everywhere", () => {
  it.each([
    ["GET /api/collections", () => collections.GET(get("http://t/api/collections"))],
    ["POST /api/collections", () => collections.POST(post("http://t/api/collections", { name: "n" }))],
    ["PATCH /api/collections/[id]", () => byId.PATCH(patch("http://t/api/collections/x", { name: "n" }), ctx("x"))],
    ["DELETE /api/collections/[id]", () => byId.DELETE(del("http://t/api/collections/x"), ctx("x"))],
    ["POST /api/collections/[id]/members", () => members.POST(post("http://t/api/collections/x/members", { add: [] }), ctx("x"))],
    ["POST /api/collections/[id]/adopt", () => adopt.POST(post("http://t/api/collections/x/adopt"), ctx("x"))],
  ])("%s", async (_n, call) => {
    caller.id = null;
    const res = await call();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });
});

describe("wrapper gates", () => {
  it.each([
    ["cross-origin POST /api/collections -> 403", () => collections.POST(crossOrigin("http://t/api/collections", "POST", { name: "n" })), 403],
    ["cross-origin PATCH /api/collections/[id] -> 403", () => byId.PATCH(crossOrigin("http://t/api/collections/x", "PATCH", {}), ctx("x")), 403],
    ["cross-origin POST members -> 403", () => members.POST(crossOrigin("http://t/api/collections/x/members", "POST", {}), ctx("x")), 403],
    ["cross-origin POST adopt -> 403", () => adopt.POST(crossOrigin("http://t/api/collections/x/adopt", "POST"), ctx("x")), 403],
    ["oversized POST /api/collections -> 413", () => collections.POST(oversized("http://t/api/collections")), 413],
    ["oversized PATCH /api/collections/[id] -> 413", () => byId.PATCH(oversized("http://t/api/collections/x", "PATCH"), ctx("x")), 413],
    ["oversized POST members -> 413", () => members.POST(oversized("http://t/api/collections/x/members"), ctx("x")), 413],
  ])("%s", async (_n, call, status) => {
    expect((await call()).status).toBe(status);
  });

  it.each([
    ["POST /api/collections without name", () => collections.POST(post("http://t/api/collections", {}))],
    ["POST /api/collections with an 81-char name", () => collections.POST(post("http://t/api/collections", { name: "x".repeat(81) }))],
    ["POST /api/collections with unknown key (strict)", () => collections.POST(post("http://t/api/collections", { name: "n", owner_id: "x" }))],
    ["PATCH with a bad visibility", () => byId.PATCH(patch("http://t/api/collections/x", { visibility: "sneaky" }), ctx("x"))],
    ["members with a non-array add", () => members.POST(post("http://t/api/collections/x/members", { add: "w1" }), ctx("x"))],
    ["members with 51 ids", () => members.POST(post("http://t/api/collections/x/members", { add: Array(51).fill("w") }), ctx("x"))],
    ["adopt with an unexpected body (strict)", () => adopt.POST(post("http://t/api/collections/x/adopt", { nope: 1 }), ctx("x"))],
  ])("%s -> 400 {error, issues}", async (_n, call) => {
    await expectIssues(await call());
  });
});

describe("happy paths (temp SQLite)", () => {
  let collectionId: string;
  let wordId: string;

  it("POST creates a collection; GET lists it with owner:false", async () => {
    const res = await collections.POST(post("http://t/api/collections", { name: "Animals", emoji: "🐾" }));
    expect(res.status).toBe(200);
    const { collection } = await res.json();
    collectionId = collection.id;
    expect(collection.name).toBe("Animals");

    const list = await (await collections.GET(get("http://t/api/collections"))).json();
    expect(list.owner).toBe(false);
    expect(list.collections.map((c: { id: string }) => c.id)).toContain(collectionId);
  });

  it("PATCH renames it; a stranger's PATCH is refused", async () => {
    const res = await byId.PATCH(patch(`http://t/api/collections/${collectionId}`, { name: "Beasts" }), ctx(collectionId));
    expect(res.status).toBe(200);
    expect((await res.json()).collection.name).toBe("Beasts");

    caller.id = "user-b";
    const forbidden = await byId.PATCH(patch(`http://t/api/collections/${collectionId}`, { name: "Mine now" }), ctx(collectionId));
    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).toEqual({ error: "forbidden" });
  });

  it("members: adds a visible word, rejects unknown ids with 400", async () => {
    const w = await store.getStore().forUser("user-a").add({ word: "lion" });
    wordId = w.id;
    const bad = await members.POST(post(`http://t/api/collections/${collectionId}/members`, { add: ["not-a-word"] }), ctx(collectionId));
    expect(bad.status).toBe(400);

    const ok = await members.POST(post(`http://t/api/collections/${collectionId}/members`, { add: [wordId] }), ctx(collectionId));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true });
  });

  it("adopt returns the member count", async () => {
    const res = await adopt.POST(post(`http://t/api/collections/${collectionId}/adopt`), ctx(collectionId));
    expect(res.status).toBe(200);
    expect((await res.json()).adopted).toBe(1);
  });

  it("DELETE removes the collection", async () => {
    const res = await byId.DELETE(del(`http://t/api/collections/${collectionId}`), ctx(collectionId));
    expect(res.status).toBe(200);
    const list = await (await collections.GET(get("http://t/api/collections"))).json();
    expect(list.collections.map((c: { id: string }) => c.id)).not.toContain(collectionId);
  });
});
