import { callVisionStructured, type ImagePart } from "../providers";
import type { ChartData } from "./types";

/*
 * Read an IELTS Academic Task 1 visual (bar/line/pie chart, process diagram, or
 * map/plan) ONCE into structured `chart_data`. This runs at ingest time from the
 * in-app "Add a question" flow — the user pastes the chart, we transcribe it here,
 * they confirm/edit, and the result is stored and reused as scoring ground truth
 * (so the text-only scorer never needs to see the image again).
 */

export const EXTRACT_CHART_SYSTEM = `You transcribe an IELTS Academic Writing Task 1 visual into structured data.
The image is a chart (bar/line/pie), a process diagram, or a map/plan.
Read EVERY label and value faithfully — this data becomes the ground truth a student's
answer is graded against, so accuracy matters more than prose.

Rules:
- Transcribe actual numbers off the axes/labels. If a value sits between gridlines, give your best read.
- Keep values as short strings exactly as shown (e.g. "70", "70%", "1.2m"). Do not invent precision.
- For a chart, each data series is one "series" entry; each point is {x: category-or-year, value}.
- For a process diagram, make each stage a series entry: label = the stage name,
  points = [{x: "detail", value: "<what happens at this stage>"}].
- For a map/plan comparison (before/after), make each notable feature a series entry:
  label = the feature, points = [{x: "before", value: "..."}, {x: "after", value: "..."}].
- "overview" = one sentence a student could use as their overview (main trend / biggest change).
- "key_trends" = 3–6 short factual bullet points a good answer should mention.
- Do not add commentary, opinions, or anything not visible in the image.`;

/** Uniform, edit-friendly shape. Works for charts, processes, and maps alike. */
export const EXTRACT_CHART_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    chart_type: {
      type: "string",
      description: "e.g. bar, grouped bar, line, pie, table, process, map",
    },
    unit: { type: "string", description: "unit of the values, or '' if not applicable" },
    overview: { type: "string" },
    key_trends: { type: "array", items: { type: "string" } },
    series: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          label: { type: "string" },
          points: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                x: { type: "string" },
                value: { type: "string" },
              },
              required: ["x", "value"],
            },
          },
        },
        required: ["label", "points"],
      },
    },
  },
  required: ["chart_type", "unit", "overview", "key_trends", "series"],
} as const;

/** Parse a `data:<mime>;base64,<data>` URL into an ImagePart. Throws if malformed. */
export function dataUrlToImagePart(dataUrl: string): ImagePart {
  const m = /^data:([^;]+);base64,([\s\S]+)$/.exec(dataUrl.trim());
  if (!m) throw new Error("Expected a base64 data URL (data:<mime>;base64,...)");
  return { mediaType: m[1], data: m[2] };
}

/** Read a chart image (data URL) into structured chart_data via the vision LLM. */
export async function extractChartData(imageDataUrl: string): Promise<ChartData> {
  const image = dataUrlToImagePart(imageDataUrl);
  const raw = (await callVisionStructured("extract-chart", {
    system: EXTRACT_CHART_SYSTEM,
    user: "Transcribe this Task 1 visual into the JSON schema. Read every label and value carefully.",
    schema: EXTRACT_CHART_JSON_SCHEMA,
    maxTokens: 2000,
    images: [image],
  })) as ChartData;
  return raw;
}
