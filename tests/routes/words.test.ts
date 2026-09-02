import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { get, post, patch, del, oversized, crossOrigin, ctx, expectIssues } from "./kit";

/*
 * Wrapper coverage for the word routes: /api/words, /api/words/[id],
 * /api/words/check, /api/words/check-bulk, /api/words/import-paste,
 * /api/import, /api/enrich. Real temp SQLite store; the LLM layer is stubbed.
 */

const caller = vi.hoisted(() => ({ id: "user-a" as string | null }));
vi.mock("@/lib/auth/user", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/auth/user")>();
  return { ...real, currentUserId: async () => caller.id };
});
vi.mock("@/lib/llm", () => ({
  hasProvider: () => true,
  hasAnyLLM: () => true,
  enrichWord: async (word: string) => ({
    enrichment: { word, vi_meaning: "nghĩa" },
    spellingSuggestion: null,
  }),
}));

let words: typeof import("@/app/api/words/route");
let wordById: typeof import("@/app/api/words/[id]/route");
let check: typeof import("@/app/api/words/check/route");
let checkBulk: typeof import("@/app/api/words/check-bulk/route");
let importPaste: typeof import("@/app/api/words/import-paste/route");
let importCsv: typeof import("@/app/api/import/route");
let enrich: typeof import("@/app/api/enrich/route");
let quota: typeof import("@/lib/auth/quota");

beforeAll(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "lexi-words-"));
  process.env.DATABASE_URL = `file:${path.join(dir, "t.db")}`;
  delete process.env.DATABASE_AUTH_TOKEN;
  delete process.env.SHEET_ID;
  delete process.env.AUTH_SECRET;
  delete process.env.AUTH_GOOGLE_ID;
  words = await import("@/app/api/words/route");
  wordById = await import("@/app/api/words/[id]/route");
  check = await import("@/app/api/words/check/route");
  checkBulk = await import("@/app/api/words/check-bulk/route");
  importPaste = await import("@/app/api/words/import-paste/route");
  importCsv = await import("@/app/api/import/route");
  enrich = await import("@/app/api/enrich/route");
  quota = await import("@/lib/auth/quota");
});

beforeEach(() => {
  caller.id = "user-a";
  quota.resetBurst();
});

describe("signed out -> 401 everywhere", () => {
  it.each([
    ["GET /api/words", () => words.GET(get("http://t/api/words"))],
    ["POST /api/words", () => words.POST(post("http://t/api/words", { word: "cat" }))],
    ["GET /api/words/[id]", () => wordById.GET(get("http://t/api/words/x"), ctx("x"))],
    ["PATCH /api/words/[id]", () => wordById.PATCH(patch("http://t/api/words/x", {}), ctx("x"))],
    ["DELETE /api/words/[id]", () => wordById.DELETE(del("http://t/api/words/x"), ctx("x"))],
    ["GET /api/words/check", () => check.GET(get("http://t/api/words/check?word=cat"))],
    ["POST /api/words/check-bulk", () => checkBulk.POST(post("http://t/api/words/check-bulk", { words: ["cat"] }))],
    ["POST /api/words/import-paste", () => importPaste.POST(post("http://t/api/words/import-paste", { words: ["cat"] }))],
    ["POST /api/import", () => importCsv.POST(post("http://t/api/import", { rows: [{ word: "cat" }] }))],
    ["POST /api/enrich", () => enrich.POST(post("http://t/api/enrich", { word: "cat" }))],
  ])("%s", async (_n, call) => {
    caller.id = null;
    const res = await call();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });
});

describe("cross-origin state changes -> 403", () => {
  it.each([
    ["POST /api/words", () => words.POST(crossOrigin("http://t/api/words", "POST", { word: "cat" }))],
    ["PATCH /api/words/[id]", () => wordById.PATCH(crossOrigin("http://t/api/words/x", "PATCH", {}), ctx("x"))],
    ["DELETE /api/words/[id]", () => wordById.DELETE(crossOrigin("http://t/api/words/x", "DELETE"), ctx("x"))],
    ["POST /api/words/check-bulk", () => checkBulk.POST(crossOrigin("http://t/api/words/check-bulk", "POST", { words: [] }))],
    ["POST /api/words/import-paste", () => importPaste.POST(crossOrigin("http://t/api/words/import-paste", "POST", { words: ["x"] }))],
    ["POST /api/import", () => importCsv.POST(crossOrigin("http://t/api/import", "POST", { rows: [{ word: "x" }] }))],
    ["POST /api/enrich", () => enrich.POST(crossOrigin("http://t/api/enrich", "POST", { word: "x" }))],
  ])("%s", async (_n, call) => {
    expect((await call()).status).toBe(403);
  });
});

describe("oversized JSON body -> 413", () => {
  it.each([
    ["POST /api/words", () => words.POST(oversized("http://t/api/words"))],
    ["PATCH /api/words/[id]", () => wordById.PATCH(oversized("http://t/api/words/x", "PATCH"), ctx("x"))],
    ["POST /api/words/check-bulk", () => checkBulk.POST(oversized("http://t/api/words/check-bulk"))],
    ["POST /api/words/import-paste", () => importPaste.POST(oversized("http://t/api/words/import-paste"))],
    ["POST /api/import", () => importCsv.POST(oversized("http://t/api/import"))],
    ["POST /api/enrich", () => enrich.POST(oversized("http://t/api/enrich"))],
  ])("%s", async (_n, call) => {
    expect((await call()).status).toBe(413);
  });
});

describe("invalid input -> 400 {error, issues}", () => {
  it.each([
    ["POST /api/words without word", () => words.POST(post("http://t/api/words", {}))],
    ["POST /api/words with a client id (strict)", () => words.POST(post("http://t/api/words", { word: "cat", id: "custom" }))],
    ["POST /api/words with client created_at (strict)", () => words.POST(post("http://t/api/words", { word: "cat", created_at: 1 }))],
    ["POST /api/words with client stage (strict)", () => words.POST(post("http://t/api/words", { word: "cat", stage: "known" }))],
    ["POST /api/words with a 101-char word", () => words.POST(post("http://t/api/words", { word: "x".repeat(101) }))],
    ["PATCH /api/words/[id] with a non-string field", () => wordById.PATCH(patch("http://t/api/words/x", { vi_meaning: 42 }), ctx("x"))],
    ["GET /api/words/check with a stray param", () => check.GET(get("http://t/api/words/check?word=cat&bogus=1"))],
    ["POST /api/words/check-bulk without words", () => checkBulk.POST(post("http://t/api/words/check-bulk", {}))],
    ["POST /api/words/check-bulk with 251 words", () => checkBulk.POST(post("http://t/api/words/check-bulk", { words: Array(251).fill("w") }))],
    ["POST /api/words/import-paste with empty words", () => importPaste.POST(post("http://t/api/words/import-paste", { words: [] }))],
    ["POST /api/import with empty rows", () => importCsv.POST(post("http://t/api/import", { rows: [] }))],
    ["POST /api/import with 501 rows", () => importCsv.POST(post("http://t/api/import", { rows: Array(501).fill({ word: "w" }) }))],
    ["POST /api/enrich without word", () => enrich.POST(post("http://t/api/enrich", {}))],
    ["POST /api/enrich malformed JSON", () => enrich.POST(new Request("http://t/api/enrich", { method: "POST", body: "{nope" }))],
  ])("%s", async (_n, call) => {
    await expectIssues(await call());
  });
});

describe("happy paths (temp SQLite)", () => {
  let id: string;

  it("POST /api/words creates; duplicate -> 409; GET lists it", async () => {
    const res = await words.POST(post("http://t/api/words", { word: "cat", vi_meaning: "mèo" }));
    expect(res.status).toBe(200);
    const { word } = await res.json();
    id = word.id;
    expect(word.word).toBe("cat");
    expect(word.owner_id).toBe("user-a");

    expect((await words.POST(post("http://t/api/words", { word: "cat" }))).status).toBe(409);

    const list = await (await words.GET(get("http://t/api/words"))).json();
    expect(list.words.map((w: { word: string }) => w.word)).toContain("cat");
  });

  it("GET /api/words/[id] returns the full word; unknown id -> 404", async () => {
    const res = await wordById.GET(get(`http://t/api/words/${id}`), ctx(id));
    expect(res.status).toBe(200);
    expect((await res.json()).word.id).toBe(id);
    expect((await wordById.GET(get("http://t/api/words/nope"), ctx("nope"))).status).toBe(404);
  });

  it("PATCH edits content but strips identity/ownership/progress keys", async () => {
    const res = await wordById.PATCH(
      patch(`http://t/api/words/${id}`, {
        vi_meaning: "mèo con",
        id: "hijack",
        owner_id: "someone-else",
        created_at: 1,
        source: "csv",
        stage: "known",
        times_seen: 99,
      }),
      ctx(id),
    );
    expect(res.status).toBe(200);
    const { word } = await res.json();
    expect(word.vi_meaning).toBe("mèo con");
    expect(word.id).toBe(id);
    expect(word.owner_id).toBe("user-a");
    expect(word.source).toBe("manual");
    expect(word.stage).toBe("new");
    expect(word.times_seen).toBe(0);
  });

  it("PATCH by a non-owner of the word -> 403", async () => {
    caller.id = "user-b";
    const res = await wordById.PATCH(patch(`http://t/api/words/${id}`, { vi_meaning: "x" }), ctx(id));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden" });
  });

  it("GET /api/words/check + POST check-bulk find the existing word", async () => {
    const one = await (await check.GET(get("http://t/api/words/check?word=CAT"))).json();
    expect(one.exists).toBe(true);
    const empty = await (await check.GET(get("http://t/api/words/check"))).json();
    expect(empty.exists).toBe(false);
    const bulk = await (await checkBulk.POST(post("http://t/api/words/check-bulk", { words: ["cat", "zebra"] }))).json();
    expect(bulk.existing).toEqual(["cat"]);
  });

  it("POST /api/import adds new rows, skips existing", async () => {
    const res = await importCsv.POST(post("http://t/api/import", { rows: [{ word: "dog" }, { word: "cat" }], enrich: false }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.created).toBe(1);
    expect(body.skipped).toBe(1);
  });

  it("POST /api/words/import-paste enriches and adds", async () => {
    const res = await importPaste.POST(post("http://t/api/words/import-paste", { words: ["bird"] }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.added).toEqual([{ word: "bird" }]);
    expect(body.quotaExhausted).toBe(false);
  });

  it("POST /api/enrich returns a preview", async () => {
    const res = await enrich.POST(post("http://t/api/enrich", { word: "sun" }));
    expect(res.status).toBe(200);
    expect((await res.json()).enrichment.vi_meaning).toBe("nghĩa");
  });

  it("DELETE /api/words/[id] removes the caller's word", async () => {
    caller.id = "user-a";
    const res = await wordById.DELETE(del(`http://t/api/words/${id}`), ctx(id));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect((await wordById.GET(get(`http://t/api/words/${id}`), ctx(id))).status).toBe(404);
  });
});
