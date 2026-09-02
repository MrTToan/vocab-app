import { describe, it, expect } from "vitest";
import { execFile } from "child_process";
import { promisify } from "util";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { createClient } from "@libsql/client";

const run = promisify(execFile);
const ROOT = path.resolve(__dirname, "..");

/*
 * QW3 — asset-durability INVARIANT (generalizes the vanishing-images class, PR
 * #37/#42). The existing route test (tests/routes/writing-image-durability.test.ts)
 * pins the image ROUTE and even asserts the fragile /public path as expected
 * behaviour — so a NEW prompt ingested with a wipeable leading-"/" path would
 * still pass every test. This closes that gap with the actual invariant:
 *
 *   A prompt persisted via the ingest path has image_path = a `data:` URL or
 *   null — NEVER a leading-"/" runtime path (public/ is baked from the repo at
 *   build time and wiped on every redeploy, orphaning the DB row -> broken img).
 *
 * It exercises the REAL ingest script (scripts/add-writing-prompt.mjs →
 * resolveImage), not a re-assertion of hand-fed input, so a regression in the
 * durability decision would fail here.
 */

/** The durability invariant: inline (data:) or absent (null) — never a wipeable path. */
function isDurableImagePath(p: string | null): boolean {
  return p === null || p.startsWith("data:");
}

// A minimal (not necessarily decodable) PNG payload — fileToDataUrl keys off the
// .png extension, so any bytes exercise the "embed a local file inline" path.
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

async function ingest(prompts: unknown): Promise<Map<string, string | null>> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "lexi-ingest-"));
  await fs.writeFile(path.join(dir, "chart.png"), PNG_BYTES);
  const jsonPath = path.join(dir, "prompts.json");
  await fs.writeFile(jsonPath, JSON.stringify(prompts));
  const dbUrl = `file:${path.join(dir, "ingest.db")}`;

  await run("node", [path.join(ROOT, "scripts/add-writing-prompt.mjs"), jsonPath], {
    env: { ...process.env, DATABASE_URL: dbUrl, DATABASE_AUTH_TOKEN: "" },
  });

  const db = createClient({ url: dbUrl });
  const rs = await db.execute("SELECT id, image_path FROM writing_prompts");
  db.close();
  return new Map(
    rs.rows.map((r) => [String(r.id), r.image_path === null ? null : String(r.image_path)]),
  );
}

describe("ingest persists a durable image_path (data: URL or null), never a wipeable /path", () => {
  it("embeds a local chart file INLINE as a data: URL", async () => {
    const rows = await ingest([
      {
        id: "t1-local",
        task_type: "task1",
        title: "Chart via image_file",
        prompt_text: "Describe the chart.",
        image_file: "chart.png", // a local file, relative to the JSON
      },
    ]);
    const stored = rows.get("t1-local");
    expect(stored).not.toBeNull();
    expect(stored!.startsWith("data:image/png;base64,")).toBe(true);
    expect(isDurableImagePath(stored!)).toBe(true);
  });

  it("keeps a text-only (task2) prompt's image_path null — still durable", async () => {
    const rows = await ingest([
      {
        id: "t2-text",
        task_type: "task2",
        title: "Opinion essay",
        prompt_text: "Some people think… Discuss.",
      },
    ]);
    expect(rows.get("t2-text")).toBeNull();
    expect(isDurableImagePath(rows.get("t2-text") ?? null)).toBe(true);
  });

  it("keeps an already-inline data: URL as-is", async () => {
    const dataUrl = "data:image/png;base64," + PNG_BYTES.toString("base64");
    const rows = await ingest([
      {
        id: "t1-inline",
        task_type: "task1",
        title: "Chart via data URL",
        prompt_text: "Describe the chart.",
        image_path: dataUrl,
      },
    ]);
    expect(rows.get("t1-inline")).toBe(dataUrl);
    expect(isDurableImagePath(rows.get("t1-inline") ?? null)).toBe(true);
  });

  it("EVERY persisted row satisfies the durability invariant", async () => {
    const rows = await ingest([
      { id: "a", task_type: "task1", title: "A", prompt_text: "x", image_file: "chart.png" },
      { id: "b", task_type: "task2", title: "B", prompt_text: "y" },
    ]);
    for (const [id, image_path] of rows) {
      expect(isDurableImagePath(image_path), `row ${id} image_path=${image_path}`).toBe(true);
    }
  });

  it("the invariant REJECTS a wipeable leading-'/' path (so it is meaningful)", () => {
    expect(isDurableImagePath("/writing/task1/chart.png")).toBe(false);
    expect(isDurableImagePath("/public/chart.png")).toBe(false);
  });
});

describe("ingest/seed scripts hardcode no wipeable /writing image path", () => {
  it("neither script assigns a leading-'/' image path literal", async () => {
    for (const rel of ["scripts/add-writing-prompt.mjs", "scripts/seed-writing-prompts.mjs"]) {
      const src = await fs.readFile(path.join(ROOT, rel), "utf8");
      // A committed literal like `image_path: "/writing/…"` reintroduces the
      // wipeable-public class the ingest fix removed. Guard against it.
      expect(src, `${rel} contains a "/writing… image literal`).not.toMatch(
        /["']\/writing\//,
      );
    }
  });
});
