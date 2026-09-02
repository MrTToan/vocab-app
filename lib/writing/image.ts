import { readFileSync } from "fs";

/** Extension → MIME for chart images we embed/serve. Keep in sync with the
 *  identical map in scripts/add-writing-prompt.mjs (that script can't import TS). */
const IMAGE_MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  svg: "image/svg+xml",
};

/** MIME for a local image path by extension, or null if unsupported. */
export function imageMimeForPath(filePath: string): string | null {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  return IMAGE_MIME_BY_EXT[ext] ?? null;
}

/**
 * Read a local image file into a `data:<mime>;base64,…` URL so it can be stored
 * INLINE in the DB (the durable `.data` volume), the way self-serve uploads are.
 * Chart images must NOT be kept as `/public` files: runtime-written public/ is
 * baked from the repo at build time and wiped on every redeploy, orphaning the
 * DB row's path. Returns null for an unsupported extension.
 */
export function fileToDataUrl(filePath: string): string | null {
  const mime = imageMimeForPath(filePath);
  if (!mime) return null;
  const base64 = readFileSync(filePath).toString("base64");
  return `data:${mime};base64,${base64}`;
}

/**
 * Inline chart images are stored as `data:<mime>;base64,<payload>` strings.
 * This decodes one so the upload route can enforce MIME/size caps and the
 * image route can serve the raw bytes with the right Content-Type.
 */
export function parseImageDataUrl(dataUrl: string): { mime: string; bytes: Buffer } | null {
  const m = /^data:([a-z]+\/[a-z0-9.+-]+)?(;[^,]*)?,([\s\S]*)$/i.exec(dataUrl);
  if (!m) return null;
  const mime = (m[1] ?? "").toLowerCase();
  const params = m[2] ?? "";
  const payload = m[3] ?? "";
  if (!mime) return null;
  const bytes = /;base64/i.test(params)
    ? Buffer.from(payload, "base64")
    : Buffer.from(decodeURIComponent(payload), "utf8");
  return { mime, bytes };
}
