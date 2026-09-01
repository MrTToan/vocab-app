import { describe, it, expect, beforeAll, vi } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";

/*
 * /api/writing/prompts input caps + ownership, /api/writing/prompts/:id
 * publish/delete gating, and the visibility-checked image route.
 */

const caller = vi.hoisted(() => ({ id: "user-a" as string | null }));
vi.mock("@/lib/auth/user", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/auth/user")>();
  return { ...mod, currentUserId: async () => caller.id };
});

let prompts: typeof import("@/app/api/writing/prompts/route");
let byId: typeof import("@/app/api/writing/prompts/[id]/route");
let image: typeof import("@/app/api/writing/prompts/[id]/image/route");

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
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const PNG = "data:image/png;base64," + Buffer.from("fake-png").toString("base64");
type Row = { id: string; can_edit: boolean; has_image: boolean };

describe("POST /api/writing/prompts validation", () => {
  it("400 on 4,001-char text", async () => {
    caller.id = "user-a";
    const res = await post({ task_type: "task2", prompt_text: "x".repeat(4001) });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/too long/);
  });
  it("400 on a too-long title", async () => {
    const res = await post({ task_type: "task2", prompt_text: "A valid prompt text.", title: "t".repeat(121) });
    expect(res.status).toBe(400);
  });
  it("400 on an oversized image", async () => {
    const big = "data:image/png;base64," + Buffer.alloc(1024 * 1024 + 1).toString("base64");
    const res = await post({ task_type: "task1", prompt_text: "Describe the chart below.", image: big });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/too large/);
  });
  it("400 on a bad MIME", async () => {
    const svg = "data:image/svg+xml;base64," + Buffer.from("<svg/>").toString("base64");
    const res = await post({ task_type: "task1", prompt_text: "Describe the chart below.", image: svg });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/PNG, JPEG or WebP/);
  });
  it("400 on an image for task2", async () => {
    const res = await post({ task_type: "task2", prompt_text: "Discuss both views.", image: PNG });
    expect(res.status).toBe(400);
  });
});

describe("prompt ownership through the routes", () => {
  let id: string;

  it("a non-owner's prompt is created private and returned without image bytes", async () => {
    caller.id = "user-a";
    const res = await post({ task_type: "task1", prompt_text: "Describe the chart below.", image: PNG });
    expect(res.status).toBe(200);
    const { prompt } = await res.json();
    id = prompt.id;
    expect(prompt.owner_id).toBe("user-a");
    expect(prompt.visibility).toBe("private");
    expect(prompt).not.toHaveProperty("image_path");
    expect(prompt.has_image).toBe(true);
  });

  it("the list has no image_path and carries can_edit; the author sees it, others don't", async () => {
    caller.id = "user-a";
    const mine = await (await prompts.GET(new Request("http://x/api/writing/prompts?task=task1"))).json();
    const row = mine.prompts.find((p: Row) => p.id === id);
    expect(row).toBeDefined();
    expect(row).not.toHaveProperty("image_path");
    expect(row.has_image).toBe(true);
    expect(row.can_edit).toBe(true);
    expect(JSON.stringify(mine)).not.toContain("base64");

    caller.id = "user-b";
    const theirs = await (await prompts.GET(new Request("http://x/api/writing/prompts?task=task1"))).json();
    expect(theirs.prompts.map((p: Row) => p.id)).not.toContain(id);
  });

  it("image route: bytes + cache headers for the author, 404 for others", async () => {
    caller.id = "user-a";
    const res = await image.GET(new Request("http://x"), ctx(id));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toBe("private, max-age=86400");
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe("fake-png");

    caller.id = "user-b";
    expect((await image.GET(new Request("http://x"), ctx(id))).status).toBe(404);
  });

  it("a non-owner cannot publish (403); another user cannot delete it (404)", async () => {
    caller.id = "user-a";
    const patch = new Request("http://x", { method: "PATCH", body: JSON.stringify({ visibility: "public" }) });
    expect((await byId.PATCH(patch, ctx(id))).status).toBe(403);

    caller.id = "user-b";
    expect((await byId.DELETE(new Request("http://x"), ctx(id))).status).toBe(404);
  });

  it("the site owner's prompt is public; the site owner can unpublish; the author can delete", async () => {
    caller.id = "local-user";
    const res = await post({ task_type: "task2", prompt_text: "Some people think X. Discuss." });
    const { prompt: sys } = await res.json();
    expect(sys.owner_id).toBe("__system__");
    expect(sys.visibility).toBe("public");

    caller.id = "user-b";
    const list = await (await prompts.GET(new Request("http://x/api/writing/prompts?task=task2"))).json();
    const row = list.prompts.find((p: Row) => p.id === sys.id);
    expect(row.can_edit).toBe(false);
    expect((await byId.DELETE(new Request("http://x"), ctx(sys.id))).status).toBe(403);

    caller.id = "local-user";
    const patch = new Request("http://x", { method: "PATCH", body: JSON.stringify({ visibility: "private" }) });
    const patched = await byId.PATCH(patch, ctx(sys.id));
    expect(patched.status).toBe(200);
    expect((await patched.json()).prompt.visibility).toBe("private");

    caller.id = "user-a";
    expect((await byId.DELETE(new Request("http://x"), ctx(id))).status).toBe(200);
  });
});
