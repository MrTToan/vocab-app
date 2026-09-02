import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { get, post, patch, del, oversized, crossOrigin, ctx, expectIssues } from "./kit";

/*
 * Wrapper coverage for every /api/writing/* route. Real temp SQLite writing
 * store; the LLM layers (@/lib/providers, scorer, discuss tutor) are stubbed.
 */

const caller = vi.hoisted(() => ({ id: "user-a" as string | null }));
vi.mock("@/lib/auth/user", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/auth/user")>();
  return { ...real, currentUserId: async () => caller.id };
});
vi.mock("@/lib/providers", () => ({
  hasProvider: () => true,
  hasAnyLLM: () => true,
  callStructured: async () => ({ reply: "ok" }),
  callVisionStructured: async () => ({
    chart_type: "bar",
    unit: "",
    overview: "",
    key_trends: [],
    series: [],
  }),
}));
const bands = {
  task_achievement: { band: 6, comment: "" },
  coherence_cohesion: { band: 6, comment: "" },
  lexical_resource: { band: 6, comment: "" },
  grammatical_range_accuracy: { band: 6, comment: "" },
};
vi.mock("@/lib/writing/score", () => ({
  scoreWriting: async () => ({
    wordCount: 42,
    overall_band: 6.5,
    bands,
    strengths: [],
    general_feedback: "solid",
    priorities: [],
    corrections: [],
  }),
}));
vi.mock("@/lib/writing/discuss", () => ({
  discussCard: async () => "Because cohesion links your ideas.",
}));

let prompts: typeof import("@/app/api/writing/prompts/route");
let promptById: typeof import("@/app/api/writing/prompts/[id]/route");
let image: typeof import("@/app/api/writing/prompts/[id]/image/route");
let submit: typeof import("@/app/api/writing/submit/route");
let submission: typeof import("@/app/api/writing/submission/route");
let discuss: typeof import("@/app/api/writing/discuss/route");
let chart: typeof import("@/app/api/writing/extract-chart/route");
let wstats: typeof import("@/app/api/writing/stats/route");
let quota: typeof import("@/lib/auth/quota");

const PNG = "data:image/png;base64," + Buffer.from("fake-png").toString("base64");
const ESSAY = "This essay argues that regular practice steadily improves writing skill over time.";

beforeAll(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "lexi-writing-"));
  process.env.DATABASE_URL = `file:${path.join(dir, "t.db")}`;
  delete process.env.DATABASE_AUTH_TOKEN;
  delete process.env.SHEET_ID;
  prompts = await import("@/app/api/writing/prompts/route");
  promptById = await import("@/app/api/writing/prompts/[id]/route");
  image = await import("@/app/api/writing/prompts/[id]/image/route");
  submit = await import("@/app/api/writing/submit/route");
  submission = await import("@/app/api/writing/submission/route");
  discuss = await import("@/app/api/writing/discuss/route");
  chart = await import("@/app/api/writing/extract-chart/route");
  wstats = await import("@/app/api/writing/stats/route");
  quota = await import("@/lib/auth/quota");
});

beforeEach(() => {
  caller.id = "user-a";
  quota.resetBurst();
});

describe("signed out -> 401 everywhere", () => {
  it.each([
    ["GET /api/writing/prompts", () => prompts.GET(get("http://t/api/writing/prompts"))],
    ["POST /api/writing/prompts", () => prompts.POST(post("http://t/api/writing/prompts", { task_type: "task2", prompt_text: "Discuss both views." }))],
    ["PATCH /api/writing/prompts/[id]", () => promptById.PATCH(patch("http://t/p/x", { visibility: "public" }), ctx("x"))],
    ["DELETE /api/writing/prompts/[id]", () => promptById.DELETE(del("http://t/p/x"), ctx("x"))],
    ["GET /api/writing/prompts/[id]/image", () => image.GET(get("http://t/p/x/image"), ctx("x"))],
    ["POST /api/writing/submit", () => submit.POST(post("http://t/api/writing/submit", { promptId: "p", text: ESSAY }))],
    ["GET /api/writing/submission", () => submission.GET(get("http://t/api/writing/submission?promptId=p"))],
    ["GET /api/writing/discuss", () => discuss.GET(get("http://t/api/writing/discuss?submissionId=s"))],
    ["POST /api/writing/discuss", () => discuss.POST(post("http://t/api/writing/discuss", { submissionId: "s", cardKey: "k", message: "why?" }))],
    ["POST /api/writing/extract-chart", () => chart.POST(post("http://t/api/writing/extract-chart", { image: PNG }))],
    ["GET /api/writing/stats", () => wstats.GET(get("http://t/api/writing/stats"))],
  ])("%s", async (_n, call) => {
    caller.id = null;
    const res = await call();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });
});

describe("wrapper gates", () => {
  it.each([
    ["cross-origin POST prompts -> 403", () => prompts.POST(crossOrigin("http://t/api/writing/prompts", "POST", { task_type: "task2", prompt_text: "Discuss." })), 403],
    ["cross-origin PATCH prompts/[id] -> 403", () => promptById.PATCH(crossOrigin("http://t/p/x", "PATCH", { visibility: "public" }), ctx("x")), 403],
    ["cross-origin POST submit -> 403", () => submit.POST(crossOrigin("http://t/api/writing/submit")), 403],
    ["cross-origin POST discuss -> 403", () => discuss.POST(crossOrigin("http://t/api/writing/discuss")), 403],
    ["cross-origin POST extract-chart -> 403", () => chart.POST(crossOrigin("http://t/api/writing/extract-chart")), 403],
    ["oversized POST submit -> 413", () => submit.POST(oversized("http://t/api/writing/submit")), 413],
    ["oversized POST discuss -> 413", () => discuss.POST(oversized("http://t/api/writing/discuss")), 413],
    ["oversized PATCH prompts/[id] (owner, >2 MB) -> 413", async () => { caller.id = "local-user"; return promptById.PATCH(oversized("http://t/p/x", "PATCH", 2 * 1024 * 1024 + 64), ctx("x")); }, 413],
    ["oversized POST prompts (owner, >2 MB) -> 413", async () => { caller.id = "local-user"; return prompts.POST(oversized("http://t/api/writing/prompts", "POST", 2 * 1024 * 1024 + 64)); }, 413],
    ["oversized POST extract-chart (>4 MB) -> 413", () => chart.POST(oversized("http://t/api/writing/extract-chart", "POST", 4 * 1024 * 1024 + 64)), 413],
  ])("%s", async (_n, call, status) => {
    expect((await call()).status).toBe(status);
  });

  it.each([
    ["GET prompts with a stray param", () => prompts.GET(get("http://t/api/writing/prompts?evil=1"))],
    ["POST prompts without prompt_text (owner)", async () => { caller.id = "local-user"; return prompts.POST(post("http://t/api/writing/prompts", { task_type: "task2" })); }],
    ["POST prompts with a 4,001-char text (owner)", async () => { caller.id = "local-user"; return prompts.POST(post("http://t/api/writing/prompts", { task_type: "task2", prompt_text: "x".repeat(4001) })); }],
    ["PATCH prompts/[id] with a bad visibility (owner)", async () => { caller.id = "local-user"; return promptById.PATCH(patch("http://t/p/x", { visibility: "sneaky" }), ctx("x")); }],
    ["GET submission without promptId", () => submission.GET(get("http://t/api/writing/submission"))],
    ["GET discuss without submissionId", () => discuss.GET(get("http://t/api/writing/discuss"))],
    ["POST discuss without cardKey", () => discuss.POST(post("http://t/api/writing/discuss", { submissionId: "s", message: "why?" }))],
    ["POST discuss with a 1,001-char message", () => discuss.POST(post("http://t/api/writing/discuss", { submissionId: "s", cardKey: "k", message: "a".repeat(1001) }))],
    ["POST submit without promptId", () => submit.POST(post("http://t/api/writing/submit", { text: ESSAY }))],
    ["POST submit with an 8,001-char essay", () => submit.POST(post("http://t/api/writing/submit", { promptId: "p", text: "x".repeat(8001) }))],
  ])("%s -> 400 {error, issues}", async (_n, call) => {
    await expectIssues(await call());
  });

  it("prompt publish is owner-only: the author's own PATCH -> 403", async () => {
    caller.id = "user-a";
    const res = await promptById.PATCH(patch("http://t/p/x", { visibility: "public" }), ctx("x"));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden" });
  });

  it("writing questions are admin-only: a non-admin cannot create or delete", async () => {
    caller.id = "user-a";
    const created = await prompts.POST(post("http://t/api/writing/prompts", { task_type: "task2", prompt_text: "Discuss both views." }));
    expect(created.status).toBe(403);
    const deleted = await promptById.DELETE(del("http://t/p/x"), ctx("x"));
    expect(deleted.status).toBe(403);
  });
});

describe("happy paths (temp SQLite)", () => {
  let promptId: string;
  let imagePromptId: string;
  let submissionId: string;

  it("the admin creates a published bank prompt; GET lists it", async () => {
    caller.id = "local-user";
    const res = await prompts.POST(
      post("http://t/api/writing/prompts", { task_type: "task2", prompt_text: "Some people think X. Discuss both views." }),
    );
    expect(res.status).toBe(200);
    const { prompt } = await res.json();
    promptId = prompt.id;
    expect(prompt.visibility).toBe("public");
    expect(prompt.owner_id).toBe("__system__");

    // any signed-in learner sees the published bank prompt
    caller.id = "user-a";
    const list = await (await prompts.GET(get("http://t/api/writing/prompts?task=task2"))).json();
    expect(list.prompts.map((p: { id: string }) => p.id)).toContain(promptId);
  });

  it("the admin creates a Task 1 prompt; the image route serves the bytes", async () => {
    caller.id = "local-user";
    const res = await prompts.POST(
      post("http://t/api/writing/prompts", { task_type: "task1", prompt_text: "Describe the chart below.", image: PNG }),
    );
    expect(res.status).toBe(200);
    const { prompt } = await res.json();
    imagePromptId = prompt.id;
    expect(prompt.has_image).toBe(true);

    const img = await image.GET(get(`http://t/p/${imagePromptId}/image`), ctx(imagePromptId));
    expect(img.status).toBe(200);
    expect(img.headers.get("content-type")).toBe("image/png");
  });

  it("the admin edits the prompt content (withOwner PATCH)", async () => {
    caller.id = "local-user";
    const res = await promptById.PATCH(patch(`http://t/p/${promptId}`, { prompt_text: "An UPDATED essay prompt." }), ctx(promptId));
    expect(res.status).toBe(200);
    const { prompt } = await res.json();
    expect(prompt.prompt_text).toMatch(/UPDATED/);
  });

  it("submit scores the essay and stores the submission", async () => {
    const res = await submit.POST(post("http://t/api/writing/submit", { promptId, text: ESSAY }));
    expect(res.status).toBe(200);
    const body = await res.json();
    submissionId = body.submission.id;
    expect(body.submission.overall_band).toBe(6.5);

    const latest = await (await submission.GET(get(`http://t/api/writing/submission?promptId=${promptId}`))).json();
    expect(latest.submission.id).toBe(submissionId);
  });

  it("discuss: GET the (empty) threads, POST a question, get the tutor reply", async () => {
    const empty = await (await discuss.GET(get(`http://t/api/writing/discuss?submissionId=${submissionId}`))).json();
    expect(empty.messages).toEqual([]);

    const res = await discuss.POST(
      post("http://t/api/writing/discuss", { submissionId, cardKey: "criterion:coherence_cohesion", message: "why?" }),
    );
    expect(res.status).toBe(200);
    const { messages } = await res.json();
    expect(messages).toHaveLength(2);

    const short = await discuss.POST(post("http://t/api/writing/discuss", { submissionId, cardKey: "k", message: "x" }));
    expect(short.status).toBe(400); // "Please type a question."
  });

  it("extract-chart reads a small PNG via the (mocked) vision provider", async () => {
    const res = await chart.POST(post("http://t/api/writing/extract-chart", { image: PNG }));
    expect(res.status).toBe(200);
    expect((await res.json()).chart_data.chart_type).toBe("bar");
    const bad = await chart.POST(post("http://t/api/writing/extract-chart", { image: "data:image/svg+xml;base64,PHN2Zy8+" }));
    expect(bad.status).toBe(400);
  });

  it("writing stats aggregates the stored submission", async () => {
    const res = await wstats.GET(get("http://t/api/writing/stats"));
    expect(res.status).toBe(200);
    expect((await res.json()).submissions).toBeGreaterThanOrEqual(1);
  });

  it("the admin deletes a prompt", async () => {
    caller.id = "local-user";
    const res = await promptById.DELETE(del(`http://t/p/${imagePromptId}`), ctx(imagePromptId));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
