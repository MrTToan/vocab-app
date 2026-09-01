import { describe, it, expect, beforeAll, vi } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";

/*
 * /api/questions/import writes the SHARED question bank (INSERT OR REPLACE by
 * id), so it must be owner-only: any signed-in non-owner gets 403.
 */

const caller = vi.hoisted(() => ({ id: "user-a" as string | null }));
vi.mock("@/lib/auth/user", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/auth/user")>();
  return { ...mod, currentUserId: async () => caller.id };
});

let POST: typeof import("@/app/api/questions/import/route").POST;

beforeAll(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "lexi-qi-"));
  process.env.DATABASE_URL = `file:${path.join(dir, "t.db")}`;
  delete process.env.DATABASE_AUTH_TOKEN;
  delete process.env.SHEET_ID;
  ({ POST } = await import("@/app/api/questions/import/route"));
});

const body = () =>
  new Request("http://x/api/questions/import", {
    method: "POST",
    body: JSON.stringify({
      questions: [{ id: "q1", word_id: "w1", type: "cloze", payload: "A ____ sentence.", answer: "test" }],
    }),
  });

describe("POST /api/questions/import", () => {
  it("401 when signed out", async () => {
    caller.id = null;
    expect((await POST(body())).status).toBe(401);
  });
  it("403 for a signed-in non-owner", async () => {
    caller.id = "user-a";
    const res = await POST(body());
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden" });
  });
  it("200 for the owner", async () => {
    caller.id = "local-user"; // DEV_USER_ID = the site owner
    const res = await POST(body());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ added: 1 });
  });
});
