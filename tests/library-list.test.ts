import { describe, it, expect, beforeAll } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { isWeak } from "../lib/ui";
import type { Result } from "../lib/types";
import type { Store } from "../lib/store";

/*
 * The Library list: server-side pagination + server-side filtering (search /
 * stage / collection) via store.listPage(), plus per-word adoption (adoptWord).
 *
 * Regression for the collection-filter bug: before this, the Library
 * intersected the user's STUDYING words with a collection's GLOBAL membership,
 * so a public collection the user hadn't fully adopted rendered "No words match"
 * (or a short list) even though the dropdown promised N. listPage(collection)
 * must return ALL the collection's members — studied and not-yet-studied — with
 * total === the dropdown count, and mark unstudied ones studying:false so the UI
 * can offer "add to my studying".
 *
 * Fresh temp DB (never the real .data/lexi.db).
 */

let store: Store;
const OWNER = "local-user"; // DEV_USER_ID → authors __system__ catalog content
const U = "learner-1"; // a regular learner who studies only some words
let colId: string;
let memberIds: string[];

beforeAll(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "lexi-liblist-"));
  process.env.DATABASE_URL = `file:${path.join(dir, "t.db")}`;
  delete process.env.DATABASE_AUTH_TOKEN;
  delete process.env.SHEET_ID;
  const mod = await import("../lib/store");
  store = mod.getStore();

  const owner = store.forUser(OWNER);
  // Author a public collection with 25 shared catalog words.
  const col = await owner.createCollection({ name: "IELTS Task 1", emoji: "📊" });
  colId = col.id;
  memberIds = [];
  for (let i = 0; i < 25; i++) {
    const w = await owner.add({
      word: `word${String(i).padStart(2, "0")}`,
      vi_meaning: `nghĩa ${i}`,
      tags: i % 2 === 0 ? ["even"] : ["odd"],
    });
    memberIds.push(w.id);
  }
  await owner.setCollectionMembers(colId, { add: memberIds });
  await owner.setCollectionVisibility(colId, "public");

  // The learner studies only the FIRST 3 members, with varied progress so the
  // stage/weak filters have something to bite on.
  const u = store.forUser(U);
  await u.setProgress(memberIds[0], {
    stage: "recall",
    times_seen: 4,
    recent_results: ["correct", "correct"] as Result[],
    last_seen_at: 100,
  });
  await u.setProgress(memberIds[1], {
    stage: "recognition",
    times_seen: 2,
    recent_results: ["incorrect", "incorrect"] as Result[], // weak
    last_seen_at: 200,
  });
  await u.setProgress(memberIds[2], {
    stage: "new",
    times_seen: 0,
    recent_results: [] as Result[],
    last_seen_at: null,
  });
});

describe("listPage: collection filter shows ALL members (the bug)", () => {
  it("returns every member — studied and not — with total === the dropdown count", async () => {
    const u = store.forUser(U);

    // The dropdown count (store.collections()) and the list total must agree.
    const cols = await u.collections();
    const dropdownCount = cols.find((c) => c.id === colId)!.count;
    expect(dropdownCount).toBe(25);

    const page = await u.listPage({ collection: colId, limit: 100, offset: 0 });
    expect(page.total).toBe(25); // NOT 3 (the studied subset)
    expect(page.words.length).toBe(25);

    // Exactly 3 are studied; the rest are offered for adoption.
    const studied = page.words.filter((w) => w.studying);
    const unstudied = page.words.filter((w) => !w.studying);
    expect(studied.length).toBe(3);
    expect(unstudied.length).toBe(22);
    // Unstudied members hydrate as stage `new`.
    expect(unstudied.every((w) => w.stage === "new")).toBe(true);
  });

  it("plain list (no collection) is the studied words only, all studying:true", async () => {
    const u = store.forUser(U);
    const page = await u.listPage({ limit: 100, offset: 0 });
    expect(page.total).toBe(3);
    expect(page.words.every((w) => w.studying)).toBe(true);
  });

  it("hides a private collection from a non-owner (no leak, empty page)", async () => {
    const owner = store.forUser(OWNER);
    const priv = await owner.createCollection({ name: "Secret" });
    await owner.setCollectionMembers(priv.id, { add: memberIds.slice(0, 5) });
    const u = store.forUser(U);
    const page = await u.listPage({ collection: priv.id, limit: 100, offset: 0 });
    expect(page).toEqual({ words: [], total: 0 });
  });
});

describe("listPage: real pagination", () => {
  it("slices by limit/offset and the pages tile the whole filter with no gaps/overlaps", async () => {
    const u = store.forUser(U);
    const size = 10;
    const seen: string[] = [];
    let offset = 0;
    let total = Infinity;
    while (offset < total) {
      const page = await u.listPage({ collection: colId, limit: size, offset });
      total = page.total;
      expect(page.words.length).toBeLessThanOrEqual(size);
      seen.push(...page.words.map((w) => w.id));
      offset += size;
    }
    expect(total).toBe(25);
    expect(seen.length).toBe(25);
    expect(new Set(seen).size).toBe(25); // no duplicates across pages
  });

  it("an offset past the end returns an empty page but the true total", async () => {
    const u = store.forUser(U);
    const page = await u.listPage({ collection: colId, limit: 10, offset: 999 });
    expect(page.words).toEqual([]);
    expect(page.total).toBe(25);
  });
});

describe("listPage: search + stage + collection compose", () => {
  it("stage filter within a collection counts unstudied members as new", async () => {
    const u = store.forUser(U);
    const page = await u.listPage({ collection: colId, stage: "new", limit: 100, offset: 0 });
    // 22 unstudied (new) + 1 studied-new member = 23.
    expect(page.total).toBe(23);
    expect(page.words.every((w) => w.stage === "new")).toBe(true);
  });

  it("weak filter matches lib/ui isWeak and never flags unstudied members", async () => {
    const u = store.forUser(U);
    const page = await u.listPage({ collection: colId, stage: "weak", limit: 100, offset: 0 });
    // Only the one studied word with two incorrects is weak.
    expect(page.total).toBe(1);
    expect(page.words.every((w) => isWeak(w))).toBe(true);
    // Cross-check: the full member set's weak count (JS) equals the SQL total.
    const all = await u.listPage({ collection: colId, limit: 100, offset: 0 });
    const jsWeak = all.words.filter((w) => isWeak(w)).length;
    expect(page.total).toBe(jsWeak);
  });

  it("search narrows within the collection (meaning/tag/word), still paged", async () => {
    const u = store.forUser(U);
    // tags: even members tagged "even" → 13 of 25 (indices 0,2,...,24).
    const byTag = await u.listPage({ collection: colId, q: "even", limit: 100, offset: 0 });
    expect(byTag.total).toBe(13);
    // a specific word
    const byWord = await u.listPage({ collection: colId, q: "word07", limit: 100, offset: 0 });
    expect(byWord.total).toBe(1);
    expect(byWord.words[0].word).toBe("word07");
    // search + stage compose: weak + "odd" tag → the weak word (index 1) is odd.
    const compose = await u.listPage({ collection: colId, q: "odd", stage: "weak", limit: 100, offset: 0 });
    expect(compose.total).toBe(1);
  });
});

describe("adoptWord: add a single visible word to studying", () => {
  it("creates the user_words row for a public member; it then studies it", async () => {
    const u = store.forUser(U);
    const target = memberIds[10]; // an unstudied member
    const before = await u.listPage({ collection: colId, limit: 100, offset: 0 });
    expect(before.words.find((w) => w.id === target)!.studying).toBe(false);

    expect(await u.adoptWord(target)).toBe(true);

    // Now it's in the plain studied list, hydrated as stage `new`, no content copied.
    const studied = await u.listPage({ limit: 100, offset: 0 });
    expect(studied.words.map((w) => w.id)).toContain(target);
    const w = (await u.get(target))!;
    expect(w.owner_id).toBe("__system__");
  });

  it("is idempotent — re-adopting keeps existing progress", async () => {
    const u = store.forUser(U);
    // memberIds[0] is a studied word with real progress; adopting must not reset it.
    expect(await u.adoptWord(memberIds[0])).toBe(true);
    const w = (await u.get(memberIds[0]))!;
    expect(w.stage).toBe("recall");
    expect(w.times_seen).toBe(4);
  });

  it("refuses an unknown id and never leaks another user's private word", async () => {
    const u = store.forUser(U);
    expect(await u.adoptWord("does-not-exist")).toBe(false);

    // A private word owned by a different regular user is invisible → not adoptable.
    const other = store.forUser("stranger");
    const secret = await other.add({ word: "secretword", vi_meaning: "bí mật" });
    expect(secret.owner_id).toBe("stranger");
    expect(await u.adoptWord(secret.id)).toBe(false);
    // And it did not sneak into the learner's studied list.
    const studied = await u.listPage({ limit: 200, offset: 0 });
    expect(studied.words.map((w) => w.id)).not.toContain(secret.id);
  });
});
