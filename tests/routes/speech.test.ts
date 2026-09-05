import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { post, crossOrigin, get } from "./kit";

/*
 * The pronunciation routes end-to-end: auth/origin gates, the Azure-primary /
 * OpenAI-fallback provider choice, the monthly-budget → fallback switch, and
 * per-user metering. No real network: `global.fetch` is stubbed to stand in for
 * the Azure and OpenAI HTTP endpoints, flipped per test via mutable knobs. The
 * DB is a throwaway SQLite file so migrate() creates `speech_usage`/`llm_usage`.
 */

let uid: string | null = "local-user"; // dev owner (quota-exempt) by default
vi.mock("@/lib/auth/user", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/auth/user")>();
  return { ...real, currentUserId: async () => uid };
});

// ── provider stub knobs ──────────────────────────────────────────────
const knobs = {
  azureTtsFail: false,
  azureAssessFail: false,
  azureSilence: false, // Azure heard no speech (InitialSilenceTimeout, no NBest)
  azureScore: 90,
  openaiHeard: "reluctant",
  calls: { azureTts: 0, azureAssess: 0, openaiTts: 0, openaiStt: 0 },
};

const realFetch = global.fetch;
function installFetchStub() {
  global.fetch = (async (input: RequestInfo | URL) => {
    const u = String(typeof input === "object" && "url" in input ? input.url : input);
    if (u.includes("tts.speech.microsoft.com")) {
      knobs.calls.azureTts++;
      if (knobs.azureTtsFail) return new Response("nope", { status: 429 });
      return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "audio/mpeg" } });
    }
    if (u.includes("stt.speech.microsoft.com")) {
      knobs.calls.azureAssess++;
      if (knobs.azureAssessFail) return new Response("nope", { status: 500 });
      // A no-speech clip: real Azure returns a non-Success status and NO NBest.
      if (knobs.azureSilence) {
        return new Response(
          JSON.stringify({ RecognitionStatus: "InitialSilenceTimeout", Offset: 10000000, Duration: 0 }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      // REAL response shape: pronunciation scores sit DIRECTLY on the NBest item,
      // not nested under a `PronunciationAssessment` object.
      return new Response(
        JSON.stringify({
          RecognitionStatus: "Success",
          DisplayText: "reluctant",
          NBest: [
            {
              Display: "reluctant",
              AccuracyScore: knobs.azureScore,
              FluencyScore: knobs.azureScore,
              CompletenessScore: 100,
              PronScore: knobs.azureScore,
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (u.includes("api.openai.com") && u.includes("/audio/speech")) {
      knobs.calls.openaiTts++;
      return new Response(new Uint8Array([9, 9, 9]), { status: 200, headers: { "content-type": "audio/mpeg" } });
    }
    if (u.includes("api.openai.com") && u.includes("/audio/transcriptions")) {
      knobs.calls.openaiStt++;
      return new Response(JSON.stringify({ text: knobs.openaiHeard }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error(`unexpected fetch: ${u}`);
  }) as typeof fetch;
}

/** A tiny valid 16 kHz mono 16-bit PCM WAV data URL (~0.1 s of silence). */
function wavDataUrl(frames = 1600): string {
  const dataLen = frames * 2;
  const buf = Buffer.alloc(44 + dataLen);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataLen, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(16000, 24);
  buf.writeUInt32LE(32000, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(dataLen, 40);
  return `data:audio/wav;base64,${buf.toString("base64")}`;
}

let tts: typeof import("@/app/api/speech/tts/route");
let assess: typeof import("@/app/api/speech/assess/route");
let config: typeof import("@/app/api/config/route");
let quota: typeof import("@/lib/auth/quota");
let usage: typeof import("@/lib/speech/usage");

function enableOpenAI() {
  process.env.LLM_1_PROVIDER = "openai";
  process.env.LLM_1_BASE_URL = "https://api.openai.com/v1";
  process.env.LLM_1_API_KEY = "sk-test";
  process.env.LLM_1_MODEL = "gpt-4o-mini";
}
function disableOpenAI() {
  delete process.env.LLM_1_PROVIDER;
  delete process.env.LLM_1_BASE_URL;
  delete process.env.LLM_1_API_KEY;
  delete process.env.LLM_1_MODEL;
}
function enableAzure() {
  process.env.AZURE_SPEECH_KEY = "azkey";
  process.env.AZURE_SPEECH_REGION = "eastus";
}
function disableAzure() {
  delete process.env.AZURE_SPEECH_KEY;
  delete process.env.AZURE_SPEECH_REGION;
}

beforeAll(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "lexi-speech-"));
  process.env.DATABASE_URL = `file:${path.join(dir, "s.db")}`;
  delete process.env.DATABASE_AUTH_TOKEN;
  delete process.env.AUTH_SECRET;
  delete process.env.AUTH_GOOGLE_ID;
  // Start from a clean provider env; individual tests opt in.
  for (let i = 1; i <= 20; i++) {
    delete process.env[`LLM_${i}_PROVIDER`];
    delete process.env[`LLM_${i}_API_KEY`];
    delete process.env[`LLM_${i}_BASE_URL`];
    delete process.env[`LLM_${i}_MODEL`];
  }
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.LLM_MODE;
  installFetchStub();
  tts = await import("@/app/api/speech/tts/route");
  assess = await import("@/app/api/speech/assess/route");
  config = await import("@/app/api/config/route");
  quota = await import("@/lib/auth/quota");
  usage = await import("@/lib/speech/usage");
});

afterAll(() => {
  global.fetch = realFetch;
});

beforeEach(() => {
  uid = "local-user";
  quota.resetBurst();
  knobs.azureTtsFail = knobs.azureAssessFail = knobs.azureSilence = false;
  knobs.azureScore = 90;
  knobs.openaiHeard = "reluctant";
  knobs.calls = { azureTts: 0, azureAssess: 0, openaiTts: 0, openaiStt: 0 };
  disableAzure();
  enableOpenAI();
});

describe("gates", () => {
  it("signed out → 401", async () => {
    uid = null;
    expect((await tts.POST(post("http://t/api/speech/tts", { word: "cat" }))).status).toBe(401);
    expect((await assess.POST(post("http://t/api/speech/assess", { word: "cat", audio: wavDataUrl() }))).status).toBe(401);
  });
  it("cross-origin → 403", async () => {
    expect((await tts.POST(crossOrigin("http://t/api/speech/tts", "POST", { word: "cat" }))).status).toBe(403);
  });
  it("no provider configured → 503, and config reports speech unavailable", async () => {
    disableOpenAI();
    disableAzure();
    expect((await tts.POST(post("http://t/api/speech/tts", { word: "cat" }))).status).toBe(503);
    expect((await assess.POST(post("http://t/api/speech/assess", { word: "cat", audio: wavDataUrl() }))).status).toBe(503);
    const cfg = (await (await config.GET(get("http://t/api/config"))).json()) as {
      speech: { tts: boolean; assess: boolean };
    };
    expect(cfg.speech).toEqual({ tts: false, assess: false });
  });
});

describe("OpenAI-only (no Azure key) — the feature works end to end", () => {
  it("hear-it returns audio via OpenAI TTS", async () => {
    const res = await tts.POST(post("http://t/api/speech/tts", { word: "reluctant", example: "She was reluctant." }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("audio/mpeg");
    expect(knobs.calls.openaiTts).toBe(1);
    expect(knobs.calls.azureTts).toBe(0);
  });
  it("say-it returns a word-match verdict + closeness score via Whisper", async () => {
    const res = await assess.POST(post("http://t/api/speech/assess", { word: "reluctant", audio: wavDataUrl() }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { provider: string; method: string; verdict: string; score: number };
    expect(body.provider).toBe("openai");
    expect(body.method).toBe("word-match");
    expect(body.verdict).toBe("good");
    // Exact hit → a real 0..100 closeness score, not null.
    expect(body.score).toBe(100);
    expect(knobs.calls.openaiStt).toBe(1);
    expect(knobs.calls.azureAssess).toBe(0);
  });
  it("a mis-heard word is needs-work with a low score", async () => {
    knobs.openaiHeard = "elephant";
    const res = await assess.POST(post("http://t/api/speech/assess", { word: "reluctant", audio: wavDataUrl() }));
    const body = (await res.json()) as { verdict: string; score: number };
    expect(body.verdict).toBe("needs-work");
    expect(body.score).toBeLessThan(70);
  });
});

describe("Azure primary + automatic fallback", () => {
  it("uses Azure phoneme scoring when configured (real flat NBest scores)", async () => {
    enableAzure();
    const res = await assess.POST(post("http://t/api/speech/assess", { word: "reluctant", audio: wavDataUrl() }));
    const body = (await res.json()) as {
      provider: string;
      method: string;
      score: number;
      verdict: string;
      detail: { accuracy: number } | null;
    };
    expect(body.provider).toBe("azure");
    expect(body.method).toBe("phoneme");
    // REGRESSION: a good clip must score its real PronScore, not 0.
    expect(body.score).toBe(90);
    expect(body.verdict).toBe("good");
    expect(body.detail?.accuracy).toBe(90);
    expect(knobs.calls.azureAssess).toBe(1);
    expect(knobs.calls.openaiStt).toBe(0);
  });
  it("returns an honest 'unclear' (not a bogus 0/100) when Azure hears no speech", async () => {
    enableAzure();
    knobs.azureSilence = true;
    const res = await assess.POST(post("http://t/api/speech/assess", { word: "reluctant", audio: wavDataUrl() }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { provider: string; verdict: string; score: number; detail: unknown };
    expect(body.provider).toBe("azure");
    expect(body.verdict).toBe("unclear");
    expect(body.score).toBe(0);
    expect(body.detail).toBeNull();
    // A silence timeout is not an Azure error → we do NOT fall back to OpenAI.
    expect(knobs.calls.azureAssess).toBe(1);
    expect(knobs.calls.openaiStt).toBe(0);
  });
  it("falls back to OpenAI when Azure errors", async () => {
    enableAzure();
    knobs.azureAssessFail = true;
    const res = await assess.POST(post("http://t/api/speech/assess", { word: "reluctant", audio: wavDataUrl() }));
    const body = (await res.json()) as { provider: string };
    expect(res.status).toBe(200);
    expect(body.provider).toBe("openai");
    expect(knobs.calls.azureAssess).toBe(1);
    expect(knobs.calls.openaiStt).toBe(1);
  });
  it("falls back to OpenAI when the Azure monthly budget is spent", async () => {
    enableAzure();
    // Spend the assessment seconds budget for this month.
    process.env.AZURE_ASSESS_SECONDS_BUDGET = "5";
    await usage.recordAzureUsage("assess_seconds", 10);
    const res = await assess.POST(post("http://t/api/speech/assess", { word: "reluctant", audio: wavDataUrl() }));
    expect(((await res.json()) as { provider: string }).provider).toBe("openai");
    expect(knobs.calls.azureAssess).toBe(0); // never even tried
    delete process.env.AZURE_ASSESS_SECONDS_BUDGET;
  });
  it("TTS falls back to OpenAI when Azure TTS errors", async () => {
    enableAzure();
    knobs.azureTtsFail = true;
    const res = await tts.POST(post("http://t/api/speech/tts", { word: "reluctant" }));
    expect(res.status).toBe(200);
    expect(knobs.calls.azureTts).toBe(1);
    expect(knobs.calls.openaiTts).toBe(1);
  });
});

describe("input validation & metering", () => {
  it("rejects a non-WAV audio MIME → 400", async () => {
    const res = await assess.POST(
      post("http://t/api/speech/assess", { word: "cat", audio: "data:audio/mp3;base64,AAAA" }),
    );
    expect(res.status).toBe(400);
  });
  it("rejects an empty recording → 400", async () => {
    const res = await assess.POST(post("http://t/api/speech/assess", { word: "cat", audio: "data:audio/wav;base64,AAAA" }));
    expect(res.status).toBe(400);
  });
  it("meters a normal user → 429 once the daily cap is spent", async () => {
    uid = "user-speak";
    process.env.QUOTA_SPEAK = "1";
    expect((await tts.POST(post("http://t/api/speech/tts", { word: "cat" }))).status).toBe(200);
    expect((await tts.POST(post("http://t/api/speech/tts", { word: "dog" }))).status).toBe(429);
    delete process.env.QUOTA_SPEAK;
  });
  it("decodeAudio validates the data URL shape", () => {
    expect("error" in assess.decodeAudio("nope")).toBe(true);
    expect("error" in assess.decodeAudio(wavDataUrl())).toBe(false);
  });
});
