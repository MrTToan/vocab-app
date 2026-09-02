#!/usr/bin/env node
// Restore/replace the chart image of an EXISTING writing prompt, IN PLACE.
//
// Usage:
//   node scripts/set-writing-image.mjs <prompt-id> <image-file>
//   node scripts/set-writing-image.mjs <mapping.json>
//
// where <mapping.json> is [{ "id": "task1-q2", "image_file": "task1-q2.png" }, …]
// (paths relative to the JSON file, or absolute).
//
// Why this exists (and why NOT scripts/add-writing-prompt.mjs for a restore):
// add-writing-prompt.mjs does INSERT OR REPLACE with the FULL row, so restoring
// only an image through it would need the exact current title/prompt_text/
// chart_data or it clobbers them. This script does a surgical
// `UPDATE writing_prompts SET image_path=? WHERE id=?` — it touches ONLY the
// image, so a question's text and stored chart_data are never at risk.
//
// The image is embedded INLINE as a durable `data:<mime>;base64,…` URL (stored
// in the persistent .data DB), never a /public path — runtime-written public/
// is baked at build time and wiped on redeploy. See docs/WRITING-SPEC.md §4 and
// the twin resolver in scripts/add-writing-prompt.mjs / lib/writing/image.ts.
// The script refuses to write a /public path or to touch a missing id.
import { createClient } from "@libsql/client";
import { readFileSync, existsSync } from "fs";
import path from "path";

// Extension → MIME for chart images. Mirrors IMAGE_MIME_BY_EXT in
// lib/writing/image.ts and scripts/add-writing-prompt.mjs.
const IMAGE_MIME_BY_EXT = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
  webp: "image/webp", svg: "image/svg+xml",
};

/** Read a local image file into a durable `data:<mime>;base64,…` URL. */
function fileToDataUrl(filePath) {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  const mime = IMAGE_MIME_BY_EXT[ext];
  if (!mime) throw new Error(`Unsupported image type for ${filePath} (png/jpeg/webp/svg only)`);
  return `data:${mime};base64,${readFileSync(filePath).toString("base64")}`;
}

/** Build the list of { id, imageFile(absolute) } jobs from argv. */
function parseJobs() {
  const a = process.argv.slice(2);
  if (a.length === 1 && a[0].toLowerCase().endsWith(".json")) {
    const jsonPath = path.resolve(a[0]);
    const baseDir = path.dirname(jsonPath);
    const raw = JSON.parse(readFileSync(jsonPath, "utf8"));
    const rows = Array.isArray(raw) ? raw : [raw];
    return rows.map((r) => {
      const ref = r.image_file ?? r.image;
      if (!r.id || !ref) throw new Error(`Each entry needs { id, image_file }: ${JSON.stringify(r)}`);
      return { id: String(r.id), imageFile: path.resolve(baseDir, ref) };
    });
  }
  if (a.length === 2) return [{ id: a[0], imageFile: path.resolve(a[1]) }];
  console.error("Usage: node scripts/set-writing-image.mjs <prompt-id> <image-file>");
  console.error("   or: node scripts/set-writing-image.mjs <mapping.json>");
  process.exit(1);
}

const url = process.env.DATABASE_URL || `file:${path.join(process.cwd(), ".data", "lexi.db")}`;
const db = createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN });

async function main() {
  const jobs = parseJobs();
  let updated = 0;
  for (const { id, imageFile } of jobs) {
    if (!existsSync(imageFile)) {
      console.error(`SKIP ${id}: image file not found: ${imageFile}`);
      continue;
    }
    const dataUrl = fileToDataUrl(imageFile);
    // Guard: never write a bare /public path here; this script is for durable
    // inline bytes only.
    if (dataUrl.startsWith("/")) {
      console.error(`SKIP ${id}: refusing to store a /public path`);
      continue;
    }
    const exists = await db.execute({
      sql: "SELECT id, task_type FROM writing_prompts WHERE id=? LIMIT 1",
      args: [id],
    });
    if (!exists.rows[0]) {
      console.error(`SKIP ${id}: no such prompt row (nothing updated)`);
      continue;
    }
    await db.execute({
      sql: "UPDATE writing_prompts SET image_path=? WHERE id=?",
      args: [dataUrl, id],
    });
    console.log(`OK ${id}: image restored inline (${Math.round(dataUrl.length / 1024)} KB data URL) from ${path.basename(imageFile)}`);
    updated++;
  }
  console.log(`Updated ${updated}/${jobs.length} prompt image(s).`);
  if (updated < jobs.length) process.exitCode = 2;
}

main().then(() => process.exit(process.exitCode ?? 0)).catch((e) => { console.error(e); process.exit(1); });
