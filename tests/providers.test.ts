import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/*
 * Provider-chain resilience: timeouts, transient-only breaker, half-open recovery,
 * reasoning_effort per task, sanitized user-facing errors. Module state (active
 * provider, failure count) is reset per test via vi.resetModules() + dynamic import.
 */

type Providers = typeof import("../lib/providers");

const OK_BODY = JSON.stringify({
  choices: [{ message: { content: JSON.stringify({ ok: true }) } }],
  usage: { prompt_tokens: 1, completion_tokens: 1 },
});

function ok(): Response {
  return new Response(OK_BODY, { status: 200, headers: { "content-type": "application/json" } });
}
function http(status: number, body = "upstream detail SECRET-BODY"): Response {
  return new Response(body, { status });
}
function timeoutError(): Error {
  const e = new Error("The operation was aborted due to timeout");
  e.name = "TimeoutError";
  return e;
}

const OPTS = { system: "sys", user: "usr", schema: { type: "object" }, maxTokens: 100 };

function chainEnv() {
  process.env.LLM_1_PROVIDER = "openai";
  process.env.LLM_1_BASE_URL = "https://one.example/v1";
  process.env.LLM_1_API_KEY = "k1";
  process.env.LLM_1_MODEL = "model-one";
  process.env.LLM_2_PROVIDER = "openai";
  process.env.LLM_2_BASE_URL = "https://two.example/v1";
  process.env.LLM_2_API_KEY = "k2";
  process.env.LLM_2_MODEL = "model-two";
}

let fetchMock: ReturnType<typeof vi.fn>;
let warn: ReturnType<typeof vi.spyOn>;

async function load(): Promise<Providers> {
  vi.resetModules();
  return import("../lib/providers");
}

/** Hosts hit, in order, e.g. ["one.example", "two.example"]. */
function hosts(): string[] {
  return fetchMock.mock.calls.map((c) => new URL(String(c[0])).host);
}
function bodyOf(callIdx: number): Record<string, unknown> {
  return JSON.parse(String((fetchMock.mock.calls[callIdx][1] as RequestInit).body));
}

beforeEach(() => {
  for (const k of Object.keys(process.env)) if (/^LLM_|^ANTHROPIC_API_KEY$/.test(k)) delete process.env[k];
  chainEnv();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  warn.mockRestore();
});

describe("timeouts", () => {
  it("passes an AbortSignal to fetch and uses the per-task budget", async () => {
    const p = await load();
    fetchMock.mockResolvedValueOnce(ok());
    await p.callStructured("enrich", OPTS);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(p.taskTimeoutMs("enrich")).toBe(25_000);
    expect(p.taskTimeoutMs("score-writing")).toBe(60_000);
    process.env.LLM_TIMEOUT_MS = "1234";
    process.env.LLM_TIMEOUT_WRITING_MS = "5678";
    expect(p.taskTimeoutMs("score")).toBe(1234);
    expect(p.taskTimeoutMs("extract-chart")).toBe(5678);
  });

  it("a timeout on #1 falls through to #2 in the same request", async () => {
    const p = await load();
    fetchMock.mockRejectedValueOnce(timeoutError()).mockResolvedValueOnce(ok());
    await expect(p.callStructured("enrich", OPTS)).resolves.toEqual({ ok: true });
    expect(hosts()).toEqual(["one.example", "two.example"]);
  });
});

describe("circuit breaker", () => {
  it("HTTP 400 does not advance the breaker (non-transient)", async () => {
    const p = await load();
    for (let i = 0; i < 4; i++) {
      // 400 on json_schema -> json_object fallback also 400 -> next provider ok
      fetchMock.mockResolvedValueOnce(http(400)).mockResolvedValueOnce(http(400)).mockResolvedValueOnce(ok());
      await p.callStructured("enrich", OPTS);
    }
    expect(p.chainStatus().active).toBe(0);
    expect(hosts()[hosts().length - 3]).toBe("one.example"); // still trying #1 first
  });

  it("three 503s in a row advance the breaker to #2", async () => {
    const p = await load();
    for (let i = 0; i < 3; i++) {
      fetchMock.mockResolvedValueOnce(http(503)).mockResolvedValueOnce(ok());
      await p.callStructured("enrich", OPTS);
      expect(p.chainStatus().active).toBe(i === 2 ? 1 : 0);
    }
    fetchMock.mockResolvedValueOnce(ok());
    await p.callStructured("enrich", OPTS);
    expect(hosts().at(-1)).toBe("two.example"); // #2 now the default
    expect(p.taskSummary("enrich")?.model).toBe("model-two");
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/failed 3x in a row — default now #2/));
  });

  it("after LLM_RECOVER_AFTER_MS the primary is retried and restored on success", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const p = await load();
    for (let i = 0; i < 3; i++) {
      fetchMock.mockResolvedValueOnce(http(503)).mockResolvedValueOnce(ok());
      await p.callStructured("enrich", OPTS);
    }
    expect(p.chainStatus().active).toBe(1);

    // Before the cool-down: no probe of #1.
    vi.setSystemTime(new Date("2026-01-01T00:04:00Z"));
    fetchMock.mockResolvedValueOnce(ok());
    await p.callStructured("enrich", OPTS);
    expect(hosts().at(-1)).toBe("two.example");
    expect(p.chainStatus().active).toBe(1);

    // After the cool-down: probe #1; it still fails -> stay on #2, clock resets.
    vi.setSystemTime(new Date("2026-01-01T00:05:01Z"));
    fetchMock.mockResolvedValueOnce(http(503)).mockResolvedValueOnce(ok());
    await expect(p.callStructured("enrich", OPTS)).resolves.toEqual({ ok: true });
    expect(hosts().slice(-2)).toEqual(["one.example", "two.example"]);
    expect(p.chainStatus().active).toBe(1);

    // Not yet another full cool-down: still no probe.
    vi.setSystemTime(new Date("2026-01-01T00:08:00Z"));
    fetchMock.mockResolvedValueOnce(ok());
    await p.callStructured("enrich", OPTS);
    expect(hosts().at(-1)).toBe("two.example");

    // Cool-down passed again: probe succeeds -> back to #1.
    vi.setSystemTime(new Date("2026-01-01T00:10:02Z"));
    fetchMock.mockResolvedValueOnce(ok());
    await p.callStructured("enrich", OPTS);
    expect(hosts().at(-1)).toBe("one.example");
    expect(p.chainStatus().active).toBe(0);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/healthy again — default back to #1/));

    fetchMock.mockResolvedValueOnce(ok());
    await p.callStructured("enrich", OPTS);
    expect(hosts().at(-1)).toBe("one.example");
  });

  it("honours LLM_RECOVER_AFTER_MS override", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    process.env.LLM_RECOVER_AFTER_MS = "1000";
    const p = await load();
    for (let i = 0; i < 3; i++) {
      fetchMock.mockResolvedValueOnce(http(503)).mockResolvedValueOnce(ok());
      await p.callStructured("score", OPTS);
    }
    vi.setSystemTime(new Date("2026-01-01T00:00:02Z"));
    fetchMock.mockResolvedValueOnce(ok());
    await p.callStructured("score", OPTS);
    expect(p.chainStatus().active).toBe(0);
  });
});

describe("request body", () => {
  it("sends reasoning_effort=low for enrich and omits it for score-writing", async () => {
    const p = await load();
    fetchMock.mockResolvedValueOnce(ok()).mockResolvedValueOnce(ok());
    await p.callStructured("enrich", OPTS);
    await p.callStructured("score-writing", OPTS);
    expect(bodyOf(0).reasoning_effort).toBe("low");
    expect(bodyOf(1)).not.toHaveProperty("reasoning_effort");
  });

  it("LLM_REASONING_EFFORT_<TASK> overrides the default", async () => {
    process.env.LLM_REASONING_EFFORT_SCORE_WRITING = "medium";
    process.env.LLM_REASONING_EFFORT_ENRICH = "none";
    const p = await load();
    expect(p.taskReasoningEffort("score-writing")).toBe("medium");
    expect(p.taskReasoningEffort("enrich")).toBeUndefined();
  });

  it("retries once without reasoning_effort when the endpoint rejects it, and remembers", async () => {
    const p = await load();
    fetchMock
      .mockResolvedValueOnce(http(400, '{"error":{"message":"Unknown parameter: reasoning_effort"}}'))
      .mockResolvedValueOnce(ok())
      .mockResolvedValueOnce(ok());
    await expect(p.callStructured("enrich", OPTS)).resolves.toEqual({ ok: true });
    expect(bodyOf(0).reasoning_effort).toBe("low");
    expect(bodyOf(1)).not.toHaveProperty("reasoning_effort");
    await p.callStructured("enrich", OPTS);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(bodyOf(2)).not.toHaveProperty("reasoning_effort"); // remembered, no retry needed
    expect(p.chainStatus().active).toBe(0);
  });

  it("sends the schema once: response_format only, inline schema only on the json_object fallback", async () => {
    const p = await load();
    fetchMock.mockResolvedValueOnce(http(400, "response_format not supported")).mockResolvedValueOnce(ok());
    await p.callStructured("enrich", OPTS);
    const first = bodyOf(0);
    const second = bodyOf(1);
    expect((first.response_format as { type: string }).type).toBe("json_schema");
    expect((first.messages as { content: string }[])[0].content).toBe("sys");
    expect((second.response_format as { type: string }).type).toBe("json_object");
    expect((second.messages as { content: string }[])[0].content).toContain('"type":"object"');
  });

  it("per-task model override LLM_<n>_MODEL_<TASK>", async () => {
    process.env.LLM_1_MODEL_ENRICH = "model-one-lite";
    const p = await load();
    expect(p.resolveChain("enrich")[0].model).toBe("model-one-lite");
    expect(p.resolveChain("score")[0].model).toBe("model-one");
    expect(p.taskSummary("enrich")?.model).toBe("model-one-lite");
  });
});

describe("user-facing errors", () => {
  it("never contain the upstream body, host or model name", async () => {
    const p = await load();
    fetchMock.mockResolvedValueOnce(http(503)).mockResolvedValueOnce(http(500, "model-two exploded"));
    const err = await p.callStructured("enrich", OPTS).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    const msg = (err as Error).message;
    expect(msg).toMatch(/temporarily unavailable/);
    expect(msg).not.toMatch(/SECRET-BODY|model-one|model-two|one\.example|HTTP 5/);
    expect((err as Error).cause).toBeDefined();
    // detail is still logged server-side
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/all providers failed.*SECRET-BODY/));
  });

  it("says 'timed out' when every provider timed out", async () => {
    const p = await load();
    fetchMock.mockRejectedValueOnce(timeoutError()).mockRejectedValueOnce(timeoutError());
    const err = await p.callStructured("enrich", OPTS).catch((e: Error) => e);
    expect((err as Error).message).toMatch(/timed out/);
    expect((err as Error).message).not.toMatch(/model-|example/);
  });

  it("vision calls are sanitized too and don't touch breaker state", async () => {
    const p = await load();
    fetchMock.mockResolvedValueOnce(http(503)).mockResolvedValueOnce(http(503));
    const err = await p.callVisionStructured("extract-chart", OPTS).catch((e: Error) => e);
    expect((err as Error).message).not.toMatch(/SECRET-BODY|model-/);
    expect(p.chainStatus().active).toBe(0);
  });
});
