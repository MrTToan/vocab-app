import { describe, it, expect, beforeAll, vi } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";

/*
 * GET /api/admin/writing-prompts — the admin "Writing Questions" management
 * list. Owner-only (403 otherwise); returns EVERY prompt (both tasks, drafts +
 * published) ignoring the per-learner visibility filter, without image bytes.
 */

const caller = vi.hoisted(() => ({ id: "local-user" as string | null }));
vi.mock("@/lib/auth/user", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/auth/user")>();
  return { ...mod, currentUserId: async () => caller.id };
});

let route: typeof import("@/app/api/admin/writing-prompts/route");
let store: typeof import("@/lib/writing/store");

const OWNER = "local-user";

beforeAll(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "lexi-adminwp-"));
  process.env.DATABASE_URL = `file:${path.join(dir, "t.db")}`;
  delete process.env.DATABASE_AUTH_TOKEN;
  route = await import("@/app/api/admin/writing-prompts/route");
  store = await import("@/lib/writing/store");

  // Seed the bank: one published Task 2, one DRAFT Task 1 (private), each owned
  // by the shared bank (__system__).
  const admin = store.writingStore.forUser(OWNER);
  await admin.addPrompts([
    { id: "pub2", task_type: "task2", title: "Published essay", prompt_text: "Discuss both views.", image_path: null, chart_data: null, model_answer: null, source_file: "t", visibility: "public" },
    { id: "draft1", task_type: "task1", title: "Draft chart", prompt_text: "Describe the chart.", image_path: "data:image/png;base64,iVBOR", chart_data: null, model_answer: null, source_file: "t", visibility: "private" },
  ]);
});

const get = (url = "http://x/api/admin/writing-prompts") => route.GET(new Request(url));
type Row = { id: string; task_type: string; visibility: string; has_image: boolean };

describe("GET /api/admin/writing-prompts", () => {
  it("403 for a non-admin", async () => {
    caller.id = "user-a";
    const res = await get();
    expect(res.status).toBe(403);
  });

  it("401 when signed out", async () => {
    caller.id = null;
    expect((await get()).status).toBe(401);
  });

  it("lists every prompt for the admin — both tasks, drafts + published, no image bytes", async () => {
    caller.id = OWNER;
    const res = await get();
    expect(res.status).toBe(200);
    const { prompts } = (await res.json()) as { prompts: Row[] };
    const ids = prompts.map((p) => p.id);
    expect(ids).toContain("pub2");
    expect(ids).toContain("draft1");
    const draft = prompts.find((p) => p.id === "draft1")!;
    expect(draft.visibility).toBe("private"); // drafts are visible to the admin
    expect(draft.has_image).toBe(true);
    expect(prompts.every((p) => !("image_path" in p))).toBe(true);
    expect(JSON.stringify(prompts)).not.toContain("iVBOR"); // no image bytes leak
  });

  it("?task= narrows by task server-side", async () => {
    caller.id = OWNER;
    const res = await get("http://x/api/admin/writing-prompts?task=task2");
    const { prompts } = (await res.json()) as { prompts: Row[] };
    expect(prompts.every((p) => p.task_type === "task2")).toBe(true);
    expect(prompts.map((p) => p.id)).toContain("pub2");
    expect(prompts.map((p) => p.id)).not.toContain("draft1");
  });
});
