#!/usr/bin/env node
// Convert inline PNG chart images to inline JPEG, IN PLACE, to shrink the DB.
//
// Task 1 charts are stored inline in writing_prompts.image_path as a
// `data:<mime>;base64,…` URL (durable — see docs/WRITING-SPEC.md §4). Self-serve
// uploads land as PNG, which is much heavier than JPEG for photographic/large
// charts. This re-encodes each `data:image/png` value to `data:image/jpeg`
// (alpha flattened onto white; JPEG has no transparency) and updates the row.
//
// Usage:
//   node scripts/convert-writing-images-to-jpeg.mjs [--quality N] [--task task1|task2] [--id <id>] [--dry-run]
//
// - Only rows whose image is a `data:image/png…` URL are touched; anything else
//   (JPEG already, SVG, a /public path, null) is skipped — so it's idempotent.
// - Touches ONLY image_path; title/prompt_text/chart_data are never altered.
// - Requires `sharp` (ships transitively with Next; present in the app container).
import { createClient } from "@libsql/client";
import path from "path";

let sharp;
try {
  sharp = (await import("sharp")).default;
} catch {
  console.error("sharp is required but not installed. Run inside the app container (it ships with Next), or `npm i sharp`.");
  process.exit(1);
}

const args = process.argv.slice(2);
const getOpt = (name, def = undefined) => {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : def;
};
const QUALITY = Number(getOpt("--quality", "85"));
const TASK = getOpt("--task");
const ONLY_ID = getOpt("--id");
const DRY = args.includes("--dry-run");

const url = process.env.DATABASE_URL || `file:${path.join(process.cwd(), ".data", "lexi.db")}`;
const db = createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN });

/** Decode a data:image/…;base64,… URL to { mime, buf }, or null. */
function decodeDataUrl(s) {
  const m = /^data:([a-z]+\/[a-z0-9.+-]+);base64,([\s\S]*)$/i.exec(s || "");
  if (!m) return null;
  return { mime: m[1].toLowerCase(), buf: Buffer.from(m[2], "base64") };
}

async function main() {
  let sql = "SELECT id, task_type, image_path FROM writing_prompts WHERE image_path LIKE 'data:image/png%'";
  const params = [];
  if (TASK) { sql += " AND task_type=?"; params.push(TASK); }
  if (ONLY_ID) { sql += " AND id=?"; params.push(ONLY_ID); }
  sql += " ORDER BY task_type, id";
  const rows = (await db.execute({ sql, args: params })).rows;

  if (!rows.length) { console.log("No inline-PNG images to convert."); return; }

  let converted = 0, savedBytes = 0;
  for (const row of rows) {
    const dec = decodeDataUrl(String(row.image_path));
    if (!dec) { console.error(`SKIP ${row.id}: not a base64 data URL`); continue; }
    const jpg = await sharp(dec.buf)
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: QUALITY, mozjpeg: true, chromaSubsampling: "4:4:4" })
      .toBuffer();
    const newUrl = `data:image/jpeg;base64,${jpg.toString("base64")}`;
    const beforeKB = Math.round(String(row.image_path).length / 1024);
    const afterKB = Math.round(newUrl.length / 1024);
    savedBytes += String(row.image_path).length - newUrl.length;
    if (!DRY) {
      await db.execute({ sql: "UPDATE writing_prompts SET image_path=? WHERE id=?", args: [newUrl, row.id] });
    }
    console.log(`${DRY ? "[dry] " : "OK "}${row.id} (${row.task_type}): ${beforeKB} KB → ${afterKB} KB`);
    converted++;
  }
  console.log(`${DRY ? "Would convert" : "Converted"} ${converted} image(s); ~${Math.round(savedBytes / 1024)} KB saved in image_path.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
