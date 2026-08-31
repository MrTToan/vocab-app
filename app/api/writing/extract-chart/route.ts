import { NextResponse } from "next/server";
import { hasProvider } from "@/lib/providers";
import { extractChartData } from "@/lib/writing/extract";

/**
 * POST { image: "data:image/png;base64,..." } -> { chart_data }
 * Reads a Task 1 chart image ONCE into structured data (vision LLM). The caller
 * (Add-a-question flow) shows the result for the user to confirm/edit before saving.
 */
export async function POST(req: Request) {
  if (!hasProvider("extract-chart")) {
    return NextResponse.json(
      { error: "No LLM configured. Add a provider (see docs/SETUP-LLM-PROVIDERS.md) to auto-read charts." },
      { status: 400 },
    );
  }

  const { image } = (await req.json()) as { image?: string };
  if (!image || !image.startsWith("data:")) {
    return NextResponse.json({ error: "image (base64 data URL) required" }, { status: 400 });
  }

  try {
    const chart_data = await extractChartData(image);
    return NextResponse.json({ chart_data });
  } catch (err: any) {
    return NextResponse.json(
      { error: `Could not read the chart: ${err?.message ?? err}` },
      { status: 502 },
    );
  }
}
