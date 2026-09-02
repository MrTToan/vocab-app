import { NextResponse } from "next/server";
import { withUser } from "@/lib/api";
import { extractChartSchema } from "@/lib/api-schemas";
import { hasProvider } from "@/lib/providers";
import { extractChartData } from "@/lib/writing/extract";
import { reserveQuota, isRateLimitError } from "@/lib/auth/quota";

/** Image types the vision providers accept; anything else is rejected up front. */
export const ALLOWED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
/** Decoded size ceiling. The client downsizes to 1200px PNG, which is far below this. */
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

/**
 * Validate a `data:<mime>;base64,<payload>` chart image. Returns a plain-English
 * problem, or null when it's acceptable. Exported for tests.
 */
export function imageProblem(image: unknown): string | null {
  if (typeof image !== "string" || !image.startsWith("data:")) {
    return "image (base64 data URL) required";
  }
  const m = /^data:([^;,]+);base64,([\s\S]*)$/.exec(image.trim());
  if (!m) return "The image must be a base64 data URL.";
  const mime = m[1].toLowerCase();
  if (!(ALLOWED_IMAGE_TYPES as readonly string[]).includes(mime)) {
    return "Please upload a PNG, JPEG, or WebP image.";
  }
  // Decoded length from base64 length (no need to decode 2 MB to measure it).
  const b64 = m[2].replace(/\s+/g, "");
  const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  const bytes = Math.floor((b64.length * 3) / 4) - padding;
  if (bytes <= 0) return "The image is empty.";
  if (bytes > MAX_IMAGE_BYTES) return "That image is too large — please use one under 2 MB.";
  return null;
}

/**
 * POST { image: "data:image/png;base64,..." } -> { chart_data }
 * Reads a Task 1 chart image ONCE into structured data (vision LLM). The caller
 * (Add-a-question flow) shows the result for the user to confirm/edit before saving.
 * Signed-in + metered (QUOTA_EXTRACT_CHART) + image type/size validated.
 */
export const POST = withUser(
  extractChartSchema,
  async ({ userId, input }) => {
    if (!hasProvider("extract-chart")) {
      return NextResponse.json(
        { error: "AI chart reading is not available right now — describe the chart yourself." },
        { status: 400 },
      );
    }

    const problem = imageProblem(input.image);
    if (problem) return NextResponse.json({ error: problem }, { status: 400 });

    try {
      await reserveQuota(userId, "extract-chart");
      const chart_data = await extractChartData(input.image as string);
      return NextResponse.json({ chart_data });
    } catch (err: unknown) {
      if (isRateLimitError(err)) {
        return NextResponse.json({ error: err.message }, { status: 429 });
      }
      return NextResponse.json(
        { error: `Could not read the chart: ${err instanceof Error ? err.message : String(err)}` },
        { status: 502 },
      );
    }
  },
  // The image is a base64 data URL of up to 2 MB decoded (~2.7 MB encoded).
  { maxBytes: 4 * 1024 * 1024 },
);
