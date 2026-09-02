import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { post, oversized, crossOrigin, expectIssues } from "./kit";

/*
 * Wrapper coverage for /api/practice/next, /api/practice/result and
 * /api/practice/score. Real temp SQLite store; the LLM layer is stubbed.
 */

const caller = vi.hoisted(() => ({ id: "user-a" as string | null }));
vi.mock("@/lib/auth/user", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/auth/user")>();
  return { ...real, currentUserId: async () => caller.id };
});
vi.mock("@/lib/llm", () => ({
  hasProvider: () => true,
  hasAnyLLM: () => true,
  generateExercise: async () => ({ cloze_sentence: "A ____ sat.", answer: "cat" }),
  scoreAnswer: async () => ({
    verdict: "pass",
    score: 95,
    reason: "good",
    correction: "",
    naturalness_note: "",
  }),
}));

let next: typeof import("@/app/api/practice/next/route");
let result: typeof import("@/app/api/practice/result/route");
let score: typeof import("@/app/api/practice/score/route");
let store: typeof import("@/lib/store");
let quota: typeof import("@/lib/auth/quota");
let wordId: string;

beforeAll(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "lexi-practice-"));
  process.env.DATABASE_URL = `file:${path.join(dir, "t.db")}`;
  delete process.env.DATABASE_AUTH_TOKEN;
  delete process.env.SHEET_ID;
  next = await import("@/app/api/practice/next/route");
  result = await import("@/app/api/practice/result/route");
  score = await import("@/app/api/practice/score/route");
  store = await import("@/lib/store");
  quota = await import("@/lib/auth/quota");
  const w = await store.getStore().forUser("user-a").add({ word: "cat", vi_meaning: "mèo" });
  wordId = w.id;
});

beforeEach(() => {
  caller.id = "user-a";
  quota.resetBurst();
});

describe("wrapper gates", () => {
  it.each([
    ["/api/practice/next", () => next.POST(post("http://t/api/practice/next", {}))],
    ["/api/practice/result", () => result.POST(post("http://t/api/practice/result", { wordId: "w", result: "correct" }))],
    ["/api/practice/score", () => score.POST(post("http://t/api/practice/score", { wordId: "w", exerciseType: "cloze" }))],
  ])("signed out %s -> 401", async (_n, call) => {
    caller.id = null;
    expect((await call()).status).toBe(401);
  });

  it.each([
    ["/api/practice/next", () => next.POST(crossOrigin("http://t/api/practice/next"))],
    ["/api/practice/result", () => result.POST(crossOrigin("http://t/api/practice/result"))],
    ["/api/practice/score", () => score.POST(crossOrigin("http://t/api/practice/score"))],
  ])("cross-origin POST %s -> 403", async (_n, call) => {
    expect((await call()).status).toBe(403);
  });

  it.each([
    ["/api/practice/next", () => next.POST(oversized("http://t/api/practice/next"))],
    ["/api/practice/result", () => result.POST(oversized("http://t/api/practice/result"))],
    ["/api/practice/score", () => score.POST(oversized("http://t/api/practice/score"))],
  ])("oversized body %s -> 413", async (_n, call) => {
    expect((await call()).status).toBe(413);
  });

  it.each([
    ["next: seenIds not an array", () => next.POST(post("http://t/api/practice/next", { seenIds: "x" }))],
    ["next: 101 seenIds", () => next.POST(post("http://t/api/practice/next", { seenIds: Array(101).fill("w") }))],
    ["result: missing wordId", () => result.POST(post("http://t/api/practice/result", { result: "correct" }))],
    ["result: unknown verdict", () => result.POST(post("http://t/api/practice/result", { wordId: "w", result: "maybe" }))],
    ["score: unknown exerciseType", () => score.POST(post("http://t/api/practice/score", { wordId: "w", exerciseType: "bogus" }))],
    ["score: oversize answer", () => score.POST(post("http://t/api/practice/score", { wordId: "w", exerciseType: "cloze", answer: "x".repeat(2001) }))],
  ])("%s -> 400 {error, issues}", async (_n, call) => {
    await expectIssues(await call());
  });
});

describe("happy paths (temp SQLite)", () => {
  it("next returns an exercise for the studied word", async () => {
    const res = await next.POST(post("http://t/api/practice/next", { seenIds: [] }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.word.id).toBe(wordId);
    expect(typeof body.exerciseType).toBe("string");
  });

  it("result records progress; unknown word -> 404", async () => {
    const res = await result.POST(post("http://t/api/practice/result", { wordId, result: "correct", exerciseType: "multiple_choice" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.from).toBe("new");
    expect(typeof body.stage).toBe("string");

    expect(
      (await result.POST(post("http://t/api/practice/result", { wordId: "missing", result: "correct" }))).status,
    ).toBe(404);
  });

  it("score grades an answer via the (mocked) LLM", async () => {
    const res = await score.POST(
      post("http://t/api/practice/score", {
        wordId,
        exerciseType: "write_sentence",
        generated: {},
        answer: "The cat sat on the mat.",
      }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).score.verdict).toBe("pass");
  });
});
