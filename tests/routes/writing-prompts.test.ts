import { describe, it, expect, beforeAll, vi } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";

/*
 * Writing questions are ADMIN-only: only the site owner may create / edit /
 * delete / publish them (server-enforced by withOwner). This covers:
 *   - non-admin create / delete / edit / publish are all rejected (403);
 *   - the admin can create (Task 1 + Task 2), edit content, publish and delete;
 *   - input caps (text/title/image) still apply (checked as the admin);
 *   - the visibility-checked image route.
 */

const caller = vi.hoisted(() => ({ id: "user-a" as string | null }));
vi.mock("@/lib/auth/user", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/auth/user")>();
  return { ...mod, currentUserId: async () => caller.id };
});

let prompts: typeof import("@/app/api/writing/prompts/route");
let byId: typeof import("@/app/api/writing/prompts/[id]/route");
let image: typeof import("@/app/api/writing/prompts/[id]/image/route");

const OWNER = "local-user"; // DEV_USER_ID = the site owner/admin (lib/auth/user.ts)

beforeAll(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "lexi-wp-"));
  process.env.DATABASE_URL = `file:${path.join(dir, "t.db")}`;
  delete process.env.DATABASE_AUTH_TOKEN;
  prompts = await import("@/app/api/writing/prompts/route");
  byId = await import("@/app/api/writing/prompts/[id]/route");
  image = await import("@/app/api/writing/prompts/[id]/image/route");
});

const post = (json: unknown) =>
  prompts.POST(new Request("http://x/api/writing/prompts", { method: "POST", body: JSON.stringify(json) }));
const patch = (id: string, json: unknown) =>
  byId.PATCH(new Request("http://x/p/" + id, { method: "PATCH", body: JSON.stringify(json) }), ctx(id));
const del = (id: string) => byId.DELETE(new Request("http://x/p/" + id, { method: "DELETE" }), ctx(id));
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const PNG = "data:image/png;base64," + Buffer.from("fake-png").toString("base64");
type Row = { id: string; can_edit: boolean; has_image: boolean };

describe("non-admins cannot manage writing questions (server-enforced)", () => {
  it("403 on create", async () => {
    caller.id = "user-a";
    const res = await post({ task_type: "task2", prompt_text: "Some people think X. Discuss." });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden" });
  });
  it("403 on publish (PATCH visibility)", async () => {
    caller.id = "user-a";
    expect((await patch("whatever", { visibility: "public" })).status).toBe(403);
  });
  it("403 on content edit (PATCH)", async () => {
    caller.id = "user-a";
    expect((await patch("whatever", { prompt_text: "hijacked prompt text" })).status).toBe(403);
  });
  it("403 on delete", async () => {
    caller.id = "user-a";
    expect((await del("whatever")).status).toBe(403);
  });
});

describe("POST /api/writing/prompts validation (as the admin)", () => {
  beforeAll(() => {
    caller.id = OWNER;
  });
  it("400 on 4,001-char text", async () => {
    caller.id = OWNER;
    const res = await post({ task_type: "task2", prompt_text: "x".repeat(4001) });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/too long/);
  });
  it("400 on a too-long title", async () => {
    caller.id = OWNER;
    const res = await post({ task_type: "task2", prompt_text: "A valid prompt text.", title: "t".repeat(121) });
    expect(res.status).toBe(400);
  });
  it("400 on an oversized image", async () => {
    caller.id = OWNER;
    const big = "data:image/png;base64," + Buffer.alloc(1024 * 1024 + 1).toString("base64");
    const res = await post({ task_type: "task1", prompt_text: "Describe the chart below.", image: big });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/too large/);
  });
  it("400 on a bad MIME", async () => {
    caller.id = OWNER;
    const svg = "data:image/svg+xml;base64," + Buffer.from("<svg/>").toString("base64");
    const res = await post({ task_type: "task1", prompt_text: "Describe the chart below.", image: svg });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/PNG, JPEG or WebP/);
  });
  it("400 on an image for task2", async () => {
    caller.id = OWNER;
    const res = await post({ task_type: "task2", prompt_text: "Discuss both views.", image: PNG });
    expect(res.status).toBe(400);
  });
});

describe("admin create / edit / publish / delete through the routes", () => {
  let id: string;

  it("the admin creates a Task 1 question in the shared bank (published)", async () => {
    caller.id = OWNER;
    const res = await post({ task_type: "task1", prompt_text: "Describe the chart below.", image: PNG });
    expect(res.status).toBe(200);
    const { prompt } = await res.json();
    id = prompt.id;
    expect(prompt.owner_id).toBe("__system__");
    expect(prompt.visibility).toBe("public");
    expect(prompt).not.toHaveProperty("image_path");
    expect(prompt.has_image).toBe(true);
  });

  it("the admin can create a draft (visibility=private)", async () => {
    caller.id = OWNER;
    const res = await post({ task_type: "task2", prompt_text: "Draft essay prompt for review.", visibility: "private" });
    const { prompt } = await res.json();
    expect(prompt.owner_id).toBe("__system__");
    expect(prompt.visibility).toBe("private");
  });

  it("learners see the published question in the list (no image bytes); it carries has_image", async () => {
    caller.id = "user-b";
    const list = await (await prompts.GET(new Request("http://x/api/writing/prompts?task=task1"))).json();
    const row = list.prompts.find((p: Row) => p.id === id);
    expect(row).toBeDefined();
    expect(row).not.toHaveProperty("image_path");
    expect(row.has_image).toBe(true);
    expect(JSON.stringify(list)).not.toContain("base64");
  });

  it("image route serves the published chart to any signed-in learner", async () => {
    caller.id = "user-b";
    const res = await image.GET(new Request("http://x"), ctx(id));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe("fake-png");
  });

  it("the admin edits the prompt text + model answer", async () => {
    caller.id = OWNER;
    const res = await patch(id, { prompt_text: "Describe the UPDATED chart below.", model_answer: "A model answer." });
    expect(res.status).toBe(200);
    const { prompt } = await res.json();
    expect(prompt.prompt_text).toMatch(/UPDATED/);
    expect(prompt.model_answer).toBe("A model answer.");
    expect(prompt.task_type).toBe("task1");
  });

  it("the admin unpublishes (PATCH visibility) — learners no longer see it", async () => {
    caller.id = OWNER;
    const res = await patch(id, { visibility: "private" });
    expect(res.status).toBe(200);
    expect((await res.json()).prompt.visibility).toBe("private");

    caller.id = "user-b";
    const list = await (await prompts.GET(new Request("http://x/api/writing/prompts?task=task1"))).json();
    expect(list.prompts.map((p: Row) => p.id)).not.toContain(id);
  });

  it("the admin deletes the question", async () => {
    caller.id = OWNER;
    const res = await del(id);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    // a second delete is a 404 (gone)
    expect((await del(id)).status).toBe(404);
  });
});
