import { describe, it, expect, beforeAll } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";

/*
 * The content/progress split. Shared CONTENT (words + questions) lives once;
 * per-user PROGRESS (user_words + user_question_state) is private. Points the
 * libSQL store at a fresh temp DB (never the real .data/lexi.db) and asserts:
 *   - the owner authors shared __system__ catalog content;
 *   - a regular user can STUDY that content but not EDIT it (studying ≠ editing);
 *   - the engine sees progress hydrated per-user from user_words;
 *   - the question bank is shared, but recency (last_shown) is per-user;
 *   - public collections are visible/adoptable by everyone, private ones are not,
 *     and adopting copies NO content.
 */

let store: any;
const OWNER = "local-user"; // DEV_USER_ID → authors __system__ catalog content
const U = "user-1"; // a regular learner

beforeAll(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "lexi-split-"));
  process.env.DATABASE_URL = `file:${path.join(dir, "t.db")}`;
  delete process.env.DATABASE_AUTH_TOKEN;
  delete process.env.SHEET_ID; // force the sqlite backend
  const mod = await import("../lib/store");
  store = mod.getStore();
});

describe("shared content, owner-gated editing", () => {
  it("owner add creates shared __system__ content everyone can see", async () => {
    const owner = store.forUser(OWNER);
    const u = store.forUser(U);
    const surge = await owner.add({ word: "surge", vi_meaning: "tăng vọt" });
    expect(surge.owner_id).toBe("__system__");

    // The owner studies what they add; the regular user does not yet.
    expect((await owner.all()).map((w: any) => w.word)).toContain("surge");
    expect(await u.all()).toEqual([]);

    // …but the content is visible to the regular user (public catalog).
    const seen = await u.get(surge.id);
    expect(seen?.word).toBe("surge");
    expect(seen?.stage).toBe("new"); // no progress row yet
  });

  it("studying grants no edit rights; only the owner edits the catalog", async () => {
    const owner = store.forUser(OWNER);
    const u = store.forUser(U);
    const [surge] = (await owner.all()).filter((w: any) => w.word === "surge");
    await expect(u.update(surge.id, { vi_meaning: "hacked" })).rejects.toThrow(
      /forbidden|cannot edit/i,
    );
    const edited = await owner.update(surge.id, { vi_meaning: "tăng mạnh" });
    expect(edited?.vi_meaning).toBe("tăng mạnh");
  });
});

describe("engine hydration: progress is per-user", () => {
  it("hydrates .stage from each user's user_words independently", async () => {
    const owner = store.forUser(OWNER);
    const u = store.forUser(U);
    const [surge] = (await owner.all()).filter((w: any) => w.word === "surge");

    await owner.setProgress(surge.id, {
      stage: "recall",
      times_seen: 3,
      recent_results: ["correct", "correct"],
      last_seen_at: 111,
    });
    await u.setProgress(surge.id, {
      stage: "recognition",
      times_seen: 1,
      recent_results: ["partial"],
      last_seen_at: 222,
    });

    const ownerWord = await owner.get(surge.id);
    const uWord = await u.get(surge.id);
    expect(ownerWord.stage).toBe("recall");
    expect(ownerWord.times_seen).toBe(3);
    expect(uWord.stage).toBe("recognition"); // same shared content, own progress
    expect(uWord.times_seen).toBe(1);

    // The regular user now studies it (has a user_words row).
    expect((await u.all()).map((w: any) => w.word)).toContain("surge");
  });
});

describe("shared question bank, per-user recency", () => {
  it("shares the bank but tracks last_shown per user", async () => {
    const owner = store.forUser(OWNER);
    const u = store.forUser(U);
    const [surge] = (await owner.all()).filter((w: any) => w.word === "surge");
    await owner.addQuestions([
      { id: "qa", word_id: surge.id, type: "cloze", direction: "", payload: "a ___", answer: "surge" },
      { id: "qb", word_id: surge.id, type: "cloze", direction: "", payload: "b ___", answer: "surge" },
    ]);

    // The bank is shared content — both users see the same total.
    expect(await owner.questionCount()).toBe(2);
    expect(await u.questionCount()).toBe(2);

    // Recency is per-user: the user's two picks exhaust both (least-recently-shown
    // first) before repeating, and the owner's recency is untouched.
    const p1 = await u.pickQuestion(surge.id, "cloze");
    const p2 = await u.pickQuestion(surge.id, "cloze");
    expect(new Set([p1.id, p2.id])).toEqual(new Set(["qa", "qb"]));
    // Owner has shown neither → still gets a valid question from the shared bank.
    expect(await owner.pickQuestion(surge.id, "cloze")).toBeTruthy();
  });
});

describe("public vs private collections", () => {
  it("scopes visibility, gates membership, and adopts without copying content", async () => {
    const owner = store.forUser(OWNER);
    const u = store.forUser(U);
    const [surge] = (await owner.all()).filter((w: any) => w.word === "surge");
    const plummet = await owner.add({ word: "plummet", vi_meaning: "lao dốc" });

    const pub = await owner.createCollection({ name: "Trends" });
    const priv = await owner.createCollection({ name: "Secret" });
    await owner.setCollectionMembers(pub.id, { add: [surge.id, plummet.id] });
    await owner.setCollectionMembers(priv.id, { add: [surge.id] });
    await owner.setCollectionVisibility(pub.id, "public");

    // The regular user sees the public collection (not mine) but not the private.
    const uCols = await u.collections();
    const uPub = uCols.find((c: any) => c.id === pub.id);
    expect(uPub).toBeTruthy();
    expect(uPub.mine).toBe(false);
    expect(uPub.visibility).toBe("public");
    expect(uCols.find((c: any) => c.id === priv.id)).toBeUndefined();

    // Public members are readable + practisable; private ones are invisible.
    expect((await u.wordIdsInCollection(pub.id)).sort()).toEqual(
      [surge.id, plummet.id].sort(),
    );
    expect(await u.wordIdsInCollection(priv.id)).toEqual([]);
    const cands = await u.practiceCandidates(pub.id);
    expect(cands.map((w: any) => w.word).sort()).toEqual(["plummet", "surge"]);

    // A non-owner cannot mutate a public pack's membership.
    await expect(
      u.setCollectionMembers(pub.id, { add: [plummet.id] }),
    ).rejects.toThrow(/forbidden|cannot modify/i);

    // Adopt = create the user's progress rows for members; copies no content.
    const before = new Set((await u.all()).map((w: any) => w.id));
    const n = await u.adoptCollection(pub.id);
    expect(n).toBe(2);
    const afterIds = (await u.all()).map((w: any) => w.id);
    expect(afterIds).toContain(plummet.id); // newly adopted
    // plummet content is still the shared catalog word — not copied to the user.
    const adopted = await u.get(plummet.id);
    expect(adopted.owner_id).toBe("__system__");
    await expect(u.update(plummet.id, { vi_meaning: "x" })).rejects.toThrow(
      /forbidden|cannot edit/i,
    );
    expect(before.has(plummet.id)).toBe(false);
  });
});
