import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Word } from "../lib/types";

/*
 * REGRESSION — "/practice 'Check my answer' returns no verdict" (2nd occurrence).
 *
 * Root cause: the provider fallback chain returned ANY parseable JSON as a
 * "success" and left schema validation to the caller (scoreAnswer's
 * ScoreSchema.parse), which runs AFTER the chain. So a primary provider that
 * returns well-formed-but-wrong-shaped JSON (routine with some OpenAI-compatible
 * shims, e.g. Gemini via its compat endpoint) short-circuited the chain — the
 * healthy fallback providers were never tried — and scoring then failed with no
 * verdict. Fix: validate INSIDE the chain (CallOpts.validate), so a schema
 * mismatch counts as a provider failure and falls through to the next provider.
 *
 * Teeth: the first test rejects pre-fix (chain hands back #1's bad JSON, #2 never
 * called, ScoreSchema.parse throws) and resolves post-fix (falls through to #2).
 */

type Providers = typeof import("../lib/providers");
type Llm = typeof import("../lib/llm");

const WORD: Word = {
  id: "w1",
  word: "resilient",
  part_of_speech: "adjective",
  ipa: "/rɪˈzɪliənt/",
  vi_meaning: "kiên cường",
  definition_en: "able to recover quickly",
  synonyms: [],
  collocations: [],
  example_simple: "",
  example_complex: "",
  false_friend_note: "",
  personal_note: "",
  tags: [],
  source: "manual",
  owner_id: "__system__",
  stage: "production",
  times_seen: 3,
  recent_results: ["correct"],
  last_seen_at: null,
  created_at: Date.now(),
};

const VALID_SCORE = {
  verdict: "pass",
  score: 88,
  reason: "Natural, correct usage.",
  correction: "",
  naturalness_note: "",
};

/** A 200 chat/completions response whose message content is `content`. */
function completion(content: unknown): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: typeof content === "string" ? content : JSON.stringify(content) } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

// Well-formed JSON that does NOT match ScoreSchema (missing verdict/score/…).
const BAD_SHAPE = { ok: true, note: "not a score" };

function twoProviderChain() {
  process.env.LLM_1_PROVIDER = "openai";
  process.env.LLM_1_BASE_URL = "https://primary.example/v1";
  process.env.LLM_1_API_KEY = "k1";
  process.env.LLM_1_MODEL = "primary-model";
  process.env.LLM_2_PROVIDER = "openai";
  process.env.LLM_2_BASE_URL = "https://fallback.example/v1";
  process.env.LLM_2_API_KEY = "k2";
  process.env.LLM_2_MODEL = "fallback-model";
}

let fetchMock: ReturnType<typeof vi.fn>;
let warn: ReturnType<typeof vi.spyOn>;

function hosts(): string[] {
  return fetchMock.mock.calls.map((c) => new URL(String(c[0])).host);
}

beforeEach(() => {
  for (const k of Object.keys(process.env)) if (/^LLM_|^ANTHROPIC_API_KEY$/.test(k)) delete process.env[k];
  twoProviderChain();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  warn.mockRestore();
});

describe("scoreAnswer — a schema-invalid primary falls through to a healthy fallback", () => {
  it("returns the fallback provider's valid verdict (not a failure)", async () => {
    vi.resetModules();
    const { scoreAnswer } = (await import("../lib/llm")) as Llm;
    // #1 returns parseable JSON that isn't a Score; #2 returns a real Score.
    fetchMock.mockResolvedValueOnce(completion(BAD_SHAPE)).mockResolvedValueOnce(completion(VALID_SCORE));

    const score = await scoreAnswer(WORD, "write_sentence", {}, "She stayed resilient.");

    expect(score.verdict).toBe("pass");
    expect(score.score).toBe(88);
    // Both providers were consulted, in order — the fallback WAS reached.
    expect(hosts()).toEqual(["primary.example", "fallback.example"]);
  });

  it("propagates a sanitized, generic error when EVERY provider returns a bad shape", async () => {
    vi.resetModules();
    const { scoreAnswer } = (await import("../lib/llm")) as Llm;
    fetchMock.mockResolvedValueOnce(completion(BAD_SHAPE)).mockResolvedValueOnce(completion(BAD_SHAPE));

    const err = await scoreAnswer(WORD, "write_sentence", {}, "x").catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    const msg = (err as Error).message;
    expect(msg).toMatch(/temporarily unavailable/);
    // The raw Zod issue dump / field names must never reach the user-facing message.
    expect(msg).not.toMatch(/verdict|ZodError|invalid_type|expected|issues/i);
    expect(hosts()).toEqual(["primary.example", "fallback.example"]);
  });
});

describe("callStructured — validate() failure is a fall-through, not a returned 'success'", () => {
  it("skips a provider whose response fails validate() and uses the next", async () => {
    vi.resetModules();
    const { callStructured } = (await import("../lib/providers")) as Providers;
    fetchMock.mockResolvedValueOnce(completion({ shape: "wrong" })).mockResolvedValueOnce(completion({ shape: "right" }));

    const out = await callStructured("score", {
      system: "s",
      user: "u",
      schema: { type: "object" },
      maxTokens: 100,
      validate: (raw) => {
        if ((raw as { shape?: string }).shape !== "right") {
          const e = new Error("bad shape");
          e.name = "ZodError";
          throw e;
        }
        return raw;
      },
    });

    expect(out).toEqual({ shape: "right" });
    expect(hosts()).toEqual(["primary.example", "fallback.example"]);
  });

  it("without validate(), any parseable JSON is still returned unchecked (back-compat)", async () => {
    vi.resetModules();
    const { callStructured } = (await import("../lib/providers")) as Providers;
    fetchMock.mockResolvedValueOnce(completion({ anything: 1 }));
    const out = await callStructured("score", { system: "s", user: "u", schema: {}, maxTokens: 100 });
    expect(out).toEqual({ anything: 1 });
    expect(hosts()).toEqual(["primary.example"]); // no needless fall-through
  });
});
