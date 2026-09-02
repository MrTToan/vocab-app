import { describe, it, expect, beforeAll, vi } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { fileToDataUrl, imageMimeForPath, parseImageDataUrl } from "@/lib/writing/image";

/*
 * REGRESSION for "Task 1 chart images fail to load for SOME questions".
 *
 * Root cause: the image route resolves a prompt's stored `image_path` two ways —
 *   - an inline `data:` URL  -> serves the bytes from the DB (durable, .data volume)
 *   - a leading-`/` path     -> 302-redirects to that /public static asset
 * A chart ingested as a `/public` file only renders while the file is physically
 * present under public/. Runtime-written public/ is baked from the repo at build
 * time and wiped on every rebuild-and-redeploy (only ./.data is a persistent
 * volume), so the DB row is left with a dangling path -> the browser follows the
 * 302 to a now-missing asset -> broken image. Inline-stored images (self-serve
 * uploads, and now ingest) never break -> only SOME questions fail.
 *
 * The fix stores ingested chart images INLINE as data URLs (fileToDataUrl), so
 * they live in the durable DB like self-serve uploads. These tests pin both the
 * divergence (so the failure is understood) and the durable path (so it holds).
 */

const caller = vi.hoisted(() => ({ id: "owner" as string | null }));
vi.mock("@/lib/auth/user", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/auth/user")>();
  return { ...mod, currentUserId: async () => caller.id };
});

let store: typeof import("@/lib/writing/store");
let image: typeof import("@/app/api/writing/prompts/[id]/image/route");
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

beforeAll(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "lexi-img-"));
  process.env.DATABASE_URL = `file:${path.join(dir, "t.db")}`;
  delete process.env.DATABASE_AUTH_TOKEN;
  store = await import("@/lib/writing/store");
  image = await import("@/app/api/writing/prompts/[id]/image/route");
});

describe("fileToDataUrl embeds chart bytes durably (the ingest fix)", () => {
  it("infers MIME by extension and only for supported image types", () => {
    expect(imageMimeForPath("chart.png")).toBe("image/png");
    expect(imageMimeForPath("CHART.JPG")).toBe("image/jpeg");
    expect(imageMimeForPath("a.jpeg")).toBe("image/jpeg");
    expect(imageMimeForPath("a.webp")).toBe("image/webp");
    expect(imageMimeForPath("a.svg")).toBe("image/svg+xml");
    expect(imageMimeForPath("a.gif")).toBeNull();
    expect(imageMimeForPath("noext")).toBeNull();
  });

  it("reads a local file into a data: URL that round-trips to the same bytes", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "lexi-file-"));
    const p = path.join(dir, "chart.png");
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5]);
    await fs.writeFile(p, bytes);
    const dataUrl = fileToDataUrl(p)!;
    expect(dataUrl.startsWith("data:image/png;base64,")).toBe(true);
    const parsed = parseImageDataUrl(dataUrl)!;
    expect(parsed.mime).toBe("image/png");
    expect(Buffer.compare(parsed.bytes, bytes)).toBe(0);
  });

  it("returns null for an unsupported extension (no accidental /public fallback)", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "lexi-file-"));
    const p = path.join(dir, "chart.gif");
    await fs.writeFile(p, Buffer.from("gif"));
    expect(fileToDataUrl(p)).toBeNull();
  });
});

describe("image route storage-shape divergence", () => {
  it("an inline data-URL prompt serves image bytes from the DB (durable path)", async () => {
    caller.id = "owner";
    const dataUrl = "data:image/png;base64," + Buffer.from("inline-bytes").toString("base64");
    const [p] = await store.writingStore.forUser("owner").addPrompts([
      { task_type: "task1", title: "Inline chart", prompt_text: "Describe the chart.", image_path: dataUrl, chart_data: null, model_answer: null, source_file: "test" },
    ]);
    const res = await image.GET(new Request("http://x"), ctx(p.id));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe("inline-bytes");
  });

  it("a /public-path prompt whose file was lost on redeploy 302s to a missing asset (the failing path)", async () => {
    caller.id = "owner";
    const [p] = await store.writingStore.forUser("owner").addPrompts([
      { task_type: "task1", title: "Ephemeral chart", prompt_text: "Describe the chart.", image_path: "/writing/task1/lost-on-redeploy.png", chart_data: null, model_answer: null, source_file: "test" },
    ]);
    const res = await image.GET(new Request("http://host/api/writing/prompts/x/image"), ctx(p.id));
    // The route hands off to a static asset that is NOT baked into the image ->
    // in production the browser follows this to a 404 -> the <img> is broken.
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("http://host/writing/task1/lost-on-redeploy.png");
  });
});
