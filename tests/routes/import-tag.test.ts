import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { get, post, oversized, crossOrigin, ctx, expectIssues } from "./kit";

/*
 * The paste importer's collection-tagging + lemma-dedup flow:
 *   POST /api/words/import-plan   (read-only preview)
 *   POST /api/words/import-paste  (enrich + add new, tag existing, collectionId)
 * Real temp SQLite store; the LLM layer is stubbed so "enrichment" is instant.
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
let plan: typeof import("@/app/api/words/import-plan/route");
let importPaste: typeof import("@/app/api/words/import-paste/route");
let collections: typeof import("@/app/api/collections/route");
let members: typeof import("@/app/api/collections/[id]/members/route");
let store: typeof import("@/lib/store");
let quota: typeof import("@/lib/auth/quota");

beforeAll(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "lexi-import-tag-"));
  process.env.DATABASE_URL = `file:${path.join(dir, "t.db")}`;
  delete process.env.DATABASE_AUTH_TOKEN;
  delete process.env.SHEET_ID;
  delete process.env.AUTH_SECRET;
  delete process.env.AUTH_GOOGLE_ID;
  words = await import("@/app/api/words/route");
  plan = await import("@/app/api/words/import-plan/route");
  importPaste = await import("@/app/api/words/import-paste/route");
  collections = await import("@/app/api/collections/route");
  members = await import("@/app/api/collections/[id]/members/route");
  store = await import("@/lib/store");
  quota = await import("@/lib/auth/quota");
});

beforeEach(() => {
  caller.id = "user-a";
  quota.resetBurst();
});

async function createCollection(name: string): Promise<string> {
  const res = await collections.POST(post("http://t/api/collections", { name }));
  return (await res.json()).collection.id;
}
async function memberIds(id: string): Promise<string[]> {
  return store.getStore().forUser(caller.id!).wordIdsInCollection(id);
}

describe("wrapper gates", () => {
  it("401 when signed out", async () => {
    caller.id = null;
    expect((await plan.POST(post("http://t/api/words/import-plan", { words: ["cat"] }))).status).toBe(401);
    expect((await importPaste.POST(post("http://t/api/words/import-paste", { words: ["cat"] }))).status).toBe(401);
  });
  it("403 cross-origin", async () => {
    expect((await plan.POST(crossOrigin("http://t/api/words/import-plan", "POST", { words: ["c"] }))).status).toBe(403);
    expect((await importPaste.POST(crossOrigin("http://t/api/words/import-paste", "POST", { words: ["c"] }))).status).toBe(403);
  });
  it("413 oversized", async () => {
    expect((await plan.POST(oversized("http://t/api/words/import-plan"))).status).toBe(413);
    expect((await importPaste.POST(oversized("http://t/api/words/import-paste"))).status).toBe(413);
  });
  it("400 on bad input", async () => {
    await expectIssues(await plan.POST(post("http://t/api/words/import-plan", { words: [] })));
    await expectIssues(await importPaste.POST(post("http://t/api/words/import-paste", { words: ["c"], bogus: 1 })));
    await expectIssues(await importPaste.POST(post("http://t/api/words/import-paste", { words: ["c"], collectionId: "" })));
  });
});

describe("import-plan — lemma dedup within list and against existing", () => {
  it("partitions new vs existing (by lemma) and merges paste repeats", async () => {
    // Seed an existing word "run" for user-a.
    await words.POST(post("http://t/api/words", { word: "run", vi_meaning: "chạy" }));

    const res = await plan.POST(
      post("http://t/api/words/import-plan", {
        // "running" ≡ existing "run"; "walk"/"walked" collapse; "walk" is new
        words: ["running", "walk", "walked", "meticulous"],
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    // "running" folds onto existing "run" → tagged, not new
    expect(body.taggedExisting.map((t: { word: string; matched: string }) => t.word)).toEqual(["running"]);
    expect(body.taggedExisting[0].matched).toBe("run");
    // "walk" and "meticulous" are new; "walked" is a lemma-repeat of "walk"
    expect(body.newWords).toEqual(["walk", "meticulous"]);
    expect(body.duplicatesInPaste).toBe(1);
  });
});

describe("import-paste — tag existing, create+tag new, never duplicate", () => {
  it("creates new words, tags them, and tags an existing word without duplicating", async () => {
    caller.id = "user-b"; // fresh user for a clean library
    const colId = await createCollection("Set B");

    // Seed existing "study" for user-b.
    await words.POST(post("http://t/api/words", { word: "study", vi_meaning: "học" }));

    // Import "studies" (≡ existing "study") + a brand-new "candid".
    const res = await importPaste.POST(
      post("http://t/api/words/import-paste", {
        words: ["studies", "candid"],
        collectionId: colId,
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.added.map((a: { word: string }) => a.word)).toEqual(["candid"]);
    expect(body.tagged.map((t: { word: string; matched: string }) => t.matched)).toEqual(["study"]);

    // The library gained exactly one word (candid), not a duplicate "studies".
    const all = await (await words.GET(get("http://t/api/words"))).json();
    const surfaces = all.words.map((w: { word: string }) => w.word).sort();
    expect(surfaces).toEqual(["candid", "study"]);

    // Both the existing and the new word are members of the collection.
    const ids = await memberIds(colId);
    expect(ids.length).toBe(2);
  });

  it("adds without a collection when none is given", async () => {
    caller.id = "user-c";
    const res = await importPaste.POST(
      post("http://t/api/words/import-paste", { words: ["ubiquitous"] }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.added).toEqual([{ word: "ubiquitous" }]);
    expect(body.tagged).toEqual([]);
  });

  it("403 when tagging into a collection the caller cannot edit", async () => {
    caller.id = "user-d";
    const colId = await createCollection("D's set");
    caller.id = "user-e"; // not the owner
    const res = await importPaste.POST(
      post("http://t/api/words/import-paste", { words: ["x"], collectionId: colId }),
    );
    expect(res.status).toBe(403);
  });
});

describe("members route reuse — tag existing ids into a collection", () => {
  it("links existing words, owner-scoped", async () => {
    caller.id = "user-f";
    const colId = await createCollection("F set");
    const w = await (await words.POST(post("http://t/api/words", { word: "candour" }))).json();
    const res = await members.POST(
      post(`http://t/api/collections/${colId}/members`, { add: [w.word.id] }),
      ctx(colId),
    );
    expect(res.status).toBe(200);
    expect(await memberIds(colId)).toEqual([w.word.id]);
  });
});
