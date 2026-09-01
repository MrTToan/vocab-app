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
