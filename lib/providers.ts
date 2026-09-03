import Anthropic from "@anthropic-ai/sdk";
import { promises as fs } from "fs";
import path from "path";
import { randomBytes } from "crypto";

/*
 * LLM provider layer with a PRIORITY FALLBACK CHAIN.
 *
 * You define an ordered list of providers (your preference). The app uses the
 * first one. If it fails 3 times IN A ROW with a *transient* error (network,
 * timeout, HTTP 408/429/5xx) the default moves to the next one. After a cool-down
 * (LLM_RECOVER_AFTER_MS, default 5 min) the next call probes the primary again
 * and, if it succeeds, moves back to it. One global chain applies to every task.
 * Within a single request, a failure on the active provider falls through the
 * rest of the chain, so one blip never fails the user's call.
 *
 * Every call has a bounded timeout (LLM_TIMEOUT_MS / LLM_TIMEOUT_WRITING_MS).
 *
 * Config (in .env.local) — numbered entries, in priority order:
 *   LLM_1_PROVIDER=openai
 *   LLM_1_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai/
 *   LLM_1_API_KEY=...            LLM_1_MODEL=gemini-flash-latest
 *   LLM_1_MODEL_ENRICH=gemini-2.5-flash-lite   # optional per-task override
 *   LLM_2_PROVIDER=openai
 *   LLM_2_BASE_URL=https://api.openai.com/v1
 *   LLM_2_API_KEY=...            LLM_2_MODEL=gpt-4o-mini
 *   LLM_3_PROVIDER=anthropic
 *   LLM_3_API_KEY=sk-ant-...     LLM_3_MODEL=claude-sonnet-5
 *
 * Back-compat (no numbered entries): single custom (LLM_MODE=custom + LLM_*) or
 * default Anthropic (ANTHROPIC_API_KEY, Haiku for enrich/generate, Sonnet for score).
 */

export type Task = "enrich" | "generate" | "score" | "score-writing" | "extract-chart" | "discuss-writing";
export type ProviderName = "anthropic" | "openai";

/** An image passed alongside the text prompt (vision). `data` is raw base64, no data: prefix. */
export interface ImagePart {
  mediaType: string; // e.g. "image/png", "image/jpeg"
  data: string; // base64, no "data:...;base64," prefix
}

interface TaskConfig {
  provider: ProviderName;
  model: string;
  apiKey: string;
  baseUrl?: string;
}

interface CallOpts {
  system: string;
  user: string;
  schema: unknown;
  maxTokens: number;
  images?: ImagePart[];
  /**
   * Validate/parse the provider's JSON *inside* the chain. It must THROW if the
   * response is unusable and otherwise return the value to hand back (parsed /
   * narrowed). A throw is treated like any other provider failure, so the chain
   * falls through to the next provider — see `callProvider`. Without it the raw
   * parsed JSON is returned unchecked (back-compat for callers that validate
   * their own result downstream).
   */
  validate?: (raw: unknown) => unknown;
}

const FAIL_THRESHOLD = 3;
const ALL_TASKS: Task[] = ["enrich", "generate", "score", "score-writing", "extract-chart", "discuss-writing"];

/** Tasks whose prompts are long / outputs large — they get the longer timeout and full reasoning. */
const HEAVY_TASKS: ReadonlySet<Task> = new Set<Task>(["score-writing", "extract-chart"]);

const DEFAULT_ANTHROPIC_MODEL: Record<Task, string> = {
  enrich: "claude-haiku-4-5",
  generate: "claude-haiku-4-5",
  score: "claude-sonnet-5",
  "score-writing": "claude-sonnet-5",
  "extract-chart": "claude-sonnet-5", // vision — read a Task 1 chart into structured data
  "discuss-writing": "claude-sonnet-5", // follow-up Q&A about a piece of feedback
};

function env(...names: string[]): string | undefined {
  for (const n of names) {
    const v = process.env[n];
    if (v && v.trim()) return v.trim();
  }
  return undefined;
}

function envInt(name: string, fallback: number): number {
  const v = env(name);
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** `score-writing` -> `SCORE_WRITING` (env-var suffix for per-task settings). */
function taskEnvSuffix(task: Task): string {
  return task.toUpperCase().replace(/-/g, "_");
}

/* ─────────────────────  per-task budgets  ─────────────────────── */

/** Timeout (ms) for one provider attempt of this task. */
export function taskTimeoutMs(task: Task): number {
  return HEAVY_TASKS.has(task)
    ? envInt("LLM_TIMEOUT_WRITING_MS", 60_000)
    : envInt("LLM_TIMEOUT_MS", 25_000);
}

/**
 * `reasoning_effort` to send to OpenAI-compatible providers for this task, or
 * undefined to omit the field. Light tasks run at "low" (faster, cheaper on
 * thinking models); heavy ones leave the provider default.
 */
export function taskReasoningEffort(task: Task): string | undefined {
  const override = env(`LLM_REASONING_EFFORT_${taskEnvSuffix(task)}`);
  if (override) return override.toLowerCase() === "none" ? undefined : override;
  return HEAVY_TASKS.has(task) ? undefined : "low";
}

/* ─────────────────────  chain resolution  ─────────────────────── */

/** Build one entry (provider config) from a set of env values, or null if incomplete. */
function makeEntry(
  provider: string | undefined,
  model: string | undefined,
  apiKey: string | undefined,
  baseUrl: string | undefined,
  task: Task,
): TaskConfig | null {
  const p = (provider || "openai").toLowerCase() as ProviderName;
  if (p === "anthropic") {
    const key = apiKey || env("ANTHROPIC_API_KEY");
    if (!key) return null;
    return { provider: "anthropic", model: model || DEFAULT_ANTHROPIC_MODEL[task], apiKey: key };
  }
  // openai-compatible
  if (!model) return null; // a model must be named
  return {
    provider: "openai",
    model,
    apiKey: apiKey || "", // local (Ollama) may need none
    baseUrl: baseUrl || "https://api.openai.com/v1",
  };
}

/** Read LLM_1_*, LLM_2_*, … in order until the first gap. */
function numberedChain(task: Task): TaskConfig[] {
  const chain: TaskConfig[] = [];
  for (let i = 1; i <= 20; i++) {
    const present =
      env(`LLM_${i}_PROVIDER`, `LLM_${i}_MODEL`, `LLM_${i}_API_KEY`) !== undefined;
    if (!present) break;
    const entry = makeEntry(
      env(`LLM_${i}_PROVIDER`),
      // LLM_<n>_MODEL_<TASK> overrides LLM_<n>_MODEL for that one task.
      env(`LLM_${i}_MODEL_${taskEnvSuffix(task)}`, `LLM_${i}_MODEL`),
      env(`LLM_${i}_API_KEY`),
      env(`LLM_${i}_BASE_URL`),
      task,
    );
    if (entry) chain.push(entry);
  }
  return chain;
}

/** The full ordered chain for a task (may be length 1 for single/default configs). */
export function resolveChain(task: Task): TaskConfig[] {
  const numbered = numberedChain(task);
  if (numbered.length) return numbered;

  // single custom
  if ((process.env.LLM_MODE || "").toLowerCase() === "custom") {
    const entry = makeEntry(
      env("LLM_PROVIDER"),
      env("LLM_MODEL"),
      env("LLM_API_KEY"),
      env("LLM_BASE_URL"),
      task,
    );
    return entry ? [entry] : [];
  }

  // default Anthropic
  const key = env("ANTHROPIC_API_KEY");
  return key
    ? [{ provider: "anthropic", model: DEFAULT_ANTHROPIC_MODEL[task], apiKey: key }]
    : [];
}

export function hasProvider(task: Task): boolean {
  return resolveChain(task).length > 0;
}
export function hasAnyLLM(): boolean {
  return ALL_TASKS.some(hasProvider);
}
export function mode(): "default" | "custom" | "chain" {
  if (numberedChain("enrich").length) return "chain";
  if ((process.env.LLM_MODE || "").toLowerCase() === "custom") return "custom";
  return "default";
}

/* ─────────────────  circuit-breaker state (per process)  ───────── */
// Advance only after FAIL_THRESHOLD consecutive *transient* failures of the active
// provider. Once advanced, after LLM_RECOVER_AFTER_MS the next call probes the
// primary (#1) once (half-open); success moves the default back to #1.

let activeIndex = 0;
let consecutiveFailures = 0;
let lastAdvanceAt = 0;

function recoverAfterMs(): number {
  return envInt("LLM_RECOVER_AFTER_MS", 300_000);
}

export function chainStatus(): {
  active: number;
  chain: { provider: ProviderName; model: string }[];
} {
  const chain = resolveChain("enrich").map((c) => ({
    provider: c.provider,
    model: c.model,
  }));
  return { active: Math.min(activeIndex, Math.max(chain.length - 1, 0)), chain };
}

/** For the config endpoint — the currently-active provider for a task (no keys). */
export function taskSummary(task: Task): { provider: ProviderName; model: string } | null {
  const chain = resolveChain(task);
  if (!chain.length) return null;
  const c = chain[Math.min(activeIndex, chain.length - 1)];
  return { provider: c.provider, model: c.model };
}

/* ─────────────────────  error classification  ─────────────────── */

/**
 * Internal error carrying enough detail for the `[llm]` log lines, plus a
 * `transient` flag that decides whether it counts toward the breaker.
 * Never surfaced to users as-is (see `userFacingError`).
 */
class ProviderError extends Error {
  constructor(
    message: string,
    readonly transient: boolean,
    readonly kind: "timeout" | "http" | "network" | "parse" | "other",
    readonly status?: number,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "ProviderError";
  }
}

function isAbortLike(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const name = (e as { name?: string }).name ?? "";
  return name === "TimeoutError" || name === "AbortError" || name === "APIConnectionTimeoutError";
}

/** A schema-validation error (Zod & friends): well-formed JSON that failed to
 *  match the expected shape. Detected structurally so this module needs no zod
 *  import. */
function isSchemaError(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const name = (e as { name?: string }).name ?? "";
  return name === "ZodError" || Array.isArray((e as { issues?: unknown }).issues);
}

/** Map anything a provider adapter may throw onto a ProviderError. */
function classify(e: unknown): ProviderError {
  if (e instanceof ProviderError) return e;
  if (isAbortLike(e)) {
    return new ProviderError("request timed out", true, "timeout", undefined, { cause: e });
  }
  if (e instanceof SyntaxError) {
    return new ProviderError(`invalid JSON from model: ${e.message}`, false, "parse", undefined, { cause: e });
  }
  // A schema validation throw (e.g. Zod) — well-formed JSON, wrong shape. Keep
  // the log line short (the full issue list is preserved as `cause`) and NEVER
  // let it reach the user verbatim; it counts as a parse failure so the chain
  // moves on to the next provider.
  if (isSchemaError(e)) {
    return new ProviderError("response did not match schema", false, "parse", undefined, { cause: e });
  }
  // Anthropic SDK errors carry a numeric `status`; connection errors carry none.
  const status = (e as { status?: unknown })?.status;
  if (typeof status === "number") {
    return new ProviderError(`HTTP ${status}: ${errMsg(e).slice(0, 300)}`, isTransientStatus(status), "http", status, { cause: e });
  }
  const msg = errMsg(e);
  const name = (e as { name?: string })?.name ?? "";
  // undici/fetch network failures ("fetch failed", ECONNRESET…) and SDK connection errors.
  if (e instanceof TypeError || name === "APIConnectionError" || /fetch failed|ECONN|ENOTFOUND|EAI_AGAIN|socket/i.test(msg)) {
    return new ProviderError(`network error: ${msg.slice(0, 300)}`, true, "network", undefined, { cause: e });
  }
  return new ProviderError(msg.slice(0, 300), false, "other", undefined, { cause: e });
}

function isTransientStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * The error handed back to route handlers (which relay `err.message` to the
 * browser). Generic on purpose: no upstream body, vendor or model name. The
 * detail lives in `cause` and in the server log under a short request id.
 */
function userFacingError(task: Task, reqId: string, errors: ProviderError[]): Error {
  const allTimeouts = errors.length > 0 && errors.every((e) => e.kind === "timeout");
  const text = allTimeouts
    ? "The AI service timed out. Please try again."
    : "The AI service is temporarily unavailable. Please try again.";
  console.warn(
    `[llm] ${reqId} all providers failed for "${task}": ` +
      errors.map((e, i) => `#${i + 1} ${e.message}`).join(" | "),
  );
  const err = new Error(`${text} (ref ${reqId})`, { cause: errors[errors.length - 1] });
  return err;
}

function newReqId(): string {
  return randomBytes(3).toString("hex");
}

/* ─────────────────────────  the call  ─────────────────────────── */

async function callProvider(task: Task, cfg: TaskConfig, opts: CallOpts): Promise<unknown> {
  try {
    const raw =
      cfg.provider === "anthropic"
        ? await anthropicStructured(task, cfg, opts)
        : await openaiStructured(task, cfg, opts);
    // Validate the parsed JSON against the caller's schema INSIDE the chain. A
    // provider that returns well-formed-but-wrong-shaped JSON (common with some
    // OpenAI-compatible shims that don't actually enforce the json_schema, e.g.
    // Gemini via its compat endpoint) then counts as a failure and falls through
    // to the next provider — instead of being handed back as a "success" that
    // only throws downstream, stranding the healthy fallbacks and blanking the
    // result for the user.
    return opts.validate ? opts.validate(raw) : raw;
  } catch (e) {
    throw classify(e);
  }
}

export async function callStructured(task: Task, opts: CallOpts): Promise<unknown> {
  const chain = resolveChain(task);
  if (!chain.length) throw new Error(`No LLM configured for "${task}"`);
  const reqId = newReqId();
  const errors: ProviderError[] = [];

  // Half-open probe: we're on a fallback and the cool-down has passed — try the
  // primary once. Success restores it as the default; failure just falls through
  // to the current active provider below (and resets the cool-down clock).
  if (activeIndex > 0 && Date.now() - lastAdvanceAt >= recoverAfterMs()) {
    const primary = chain[0];
    try {
      const result = await callProvider(task, primary, opts);
      console.warn(
        `[llm] ${reqId} primary #1 (${primary.provider}/${primary.model}) healthy again — default back to #1`,
      );
      activeIndex = 0;
      consecutiveFailures = 0;
      return result;
    } catch (err) {
      const pe = classify(err);
      errors.push(pe);
      lastAdvanceAt = Date.now();
      console.warn(
        `[llm] ${reqId} primary #1 (${primary.provider}/${primary.model}) still failing for "${task}" (${pe.message}) — staying on #${Math.min(activeIndex, chain.length - 1) + 1}`,
      );
    }
  }

  const start = Math.min(activeIndex, chain.length - 1);
  // Try the active provider, then fall THROUGH the rest of the chain in the SAME
  // request. A transient blip on #1 (e.g. "fetch failed") no longer fails the user's
  // one call — it transparently retries #2/#3. The 3-strike counter still advances
  // the *default* starting provider so we don't keep hitting a persistently-dead one.
  for (let i = start; i < chain.length; i++) {
    const cfg = chain[i];
    try {
      const result = await callProvider(task, cfg, opts);
      if (i === start) consecutiveFailures = 0; // active provider healthy again
      return result;
    } catch (err) {
      const pe = classify(err);
      errors.push(pe);
      if (i === start && pe.transient) {
        consecutiveFailures++;
        if (consecutiveFailures >= FAIL_THRESHOLD && activeIndex < chain.length - 1) {
          activeIndex++;
          consecutiveFailures = 0;
          lastAdvanceAt = Date.now();
          const next = chain[activeIndex];
          console.warn(
            `[llm] ${reqId} provider #${i + 1} (${cfg.provider}/${cfg.model}) failed ` +
              `${FAIL_THRESHOLD}x in a row — default now #${activeIndex + 1} ` +
              `(${next.provider}/${next.model}) for ${Math.round(recoverAfterMs() / 1000)}s. Reason: ${pe.message}`,
          );
        }
      }
      if (i < chain.length - 1) {
        console.warn(
          `[llm] ${reqId} ${cfg.provider}/${cfg.model} failed for "${task}" (${pe.message}) — trying next in chain`,
        );
      }
    }
  }
  throw userFacingError(task, reqId, errors);
}

/**
 * Like callStructured, but for a ONE-SHOT vision read: walk the whole chain in
 * order and return the first provider that succeeds, skipping any that error
 * (e.g. a text-only model that can't accept an image, or a provider having a
 * transient outage). Does NOT touch the global active-provider state, so a blip
 * here never poisons the text chain used for scoring. Meant for occasional,
 * manual ingest — trying an extra provider is fine.
 */
export async function callVisionStructured(task: Task, opts: CallOpts): Promise<unknown> {
  const chain = resolveChain(task);
  if (!chain.length) throw new Error(`No LLM configured for "${task}"`);
  const reqId = newReqId();
  const errors: ProviderError[] = [];
  for (const cfg of chain) {
    try {
      return await callProvider(task, cfg, opts);
    } catch (err) {
      const pe = classify(err);
      errors.push(pe);
      console.warn(`[llm] ${reqId} vision read on ${cfg.provider}/${cfg.model} failed: ${pe.message} — trying next`);
    }
  }
  throw userFacingError(task, reqId, errors);
}

/* ── Anthropic ── */

const anthropicClients = new Map<string, Anthropic>();
function anthropicClient(apiKey: string, timeout: number): Anthropic {
  const key = `${apiKey}:${timeout}`;
  let c = anthropicClients.get(key);
  if (!c) {
    c = new Anthropic({ apiKey, timeout, maxRetries: 1 });
    anthropicClients.set(key, c);
  }
  return c;
}

async function anthropicStructured(
  task: Task,
  cfg: TaskConfig,
  { system, user, schema, maxTokens, images }: CallOpts,
): Promise<unknown> {
  const content: unknown[] = [{ type: "text", text: user }];
  for (const img of images ?? []) {
    content.push({
      type: "image",
      source: { type: "base64", media_type: img.mediaType, data: img.data },
    });
  }
  type AnthropicMessage = {
    content: { type: string; text?: string }[];
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  const resp = (await anthropicClient(cfg.apiKey, taskTimeoutMs(task)).messages.create({
    model: cfg.model,
    max_tokens: maxTokens,
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    output_config: { format: { type: "json_schema", schema } },
    messages: [{ role: "user", content }],
  } as unknown as Parameters<Anthropic["messages"]["create"]>[0])) as unknown as AnthropicMessage;
  logUsage(task, "anthropic", cfg.model, {
    input: resp.usage?.input_tokens,
    output: resp.usage?.output_tokens,
  });
  const textBlock = resp.content.find((b) => b.type === "text" && typeof b.text === "string") as
    | { text: string }
    | undefined;
  if (!textBlock) throw new ProviderError("model returned no text block", false, "parse");
  return JSON.parse(textBlock.text);
}

/* ── OpenAI-compatible ── */

/** (baseUrl|model) keys of endpoints that rejected `reasoning_effort` — don't send it again. */
const noReasoningEffort = new Set<string>();

function reasoningKey(cfg: TaskConfig): string {
  return `${cfg.baseUrl}|${cfg.model}`;
}

async function openaiStructured(
  task: Task,
  cfg: TaskConfig,
  { system, user, schema, maxTokens, images }: CallOpts,
): Promise<unknown> {
  // With images, the user turn becomes multimodal content parts; otherwise a plain string.
  const userContent = images?.length
    ? [
        { type: "text", text: user },
        ...images.map((img) => ({
          type: "image_url",
          image_url: { url: `data:${img.mediaType};base64,${img.data}` },
        })),
      ]
    : user;
  const userMsg = { role: "user", content: userContent };

  // First attempt: strict json_schema via response_format only (the schema is NOT
  // duplicated into the prompt). Fallback for providers without json_schema
  // support: json_object mode with the schema inlined in the system message.
  let res = await openaiPost(task, cfg, [{ role: "system", content: system }, userMsg], maxTokens, {
    type: "json_schema",
    json_schema: { name: "result", strict: true, schema },
  });
  if (!res.ok && (res.status === 400 || res.status === 422)) {
    const inlined = {
      role: "system",
      content: `${system}\n\nReturn ONLY a single JSON object (no markdown, no prose) matching this JSON schema:\n${JSON.stringify(schema)}`,
    };
    res = await openaiPost(task, cfg, [inlined, userMsg], maxTokens, { type: "json_object" });
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ProviderError(
      `HTTP ${res.status}: ${body.slice(0, 300)}`,
      isTransientStatus(res.status),
      "http",
      res.status,
    );
  }
  const data = (await res.json()) as {
    usage?: { prompt_tokens?: number; completion_tokens?: number };
    choices?: { message?: { content?: string } }[];
  };
  logUsage(task, "openai", cfg.model, {
    input: data.usage?.prompt_tokens,
    output: data.usage?.completion_tokens,
  });
  const content: string = data.choices?.[0]?.message?.content ?? "";
  if (!content.trim()) throw new ProviderError("model returned empty content", false, "parse");
  return JSON.parse(stripFence(content));
}

/**
 * One POST to /chat/completions with a bounded timeout. Sends `reasoning_effort`
 * for light tasks; if the endpoint rejects the field (400 naming it) retries once
 * without and remembers not to send it to that (baseUrl, model) again.
 */
async function openaiPost(
  task: Task,
  cfg: TaskConfig,
  messages: unknown,
  maxTokens: number,
  responseFormat: unknown,
): Promise<Response> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cfg.apiKey) headers["Authorization"] = `Bearer ${cfg.apiKey}`;
  const url = `${cfg.baseUrl!.replace(/\/$/, "")}/chat/completions`;
  const timeout = taskTimeoutMs(task);
  const effort = noReasoningEffort.has(reasoningKey(cfg)) ? undefined : taskReasoningEffort(task);

  const post = (withEffort: string | undefined) =>
    fetch(url, {
      method: "POST",
      headers,
      signal: AbortSignal.timeout(timeout),
      body: JSON.stringify({
        model: cfg.model,
        max_tokens: maxTokens,
        messages,
        response_format: responseFormat,
        ...(withEffort ? { reasoning_effort: withEffort } : {}),
      }),
    });

  const res = await post(effort);
  if (effort && res.status === 400) {
    const body = await res.clone().text().catch(() => "");
    if (/reasoning[_ ]effort/i.test(body)) {
      noReasoningEffort.add(reasoningKey(cfg));
      console.warn(`[llm] ${cfg.model} rejected reasoning_effort — retrying without it (remembered)`);
      return post(undefined);
    }
  }
  return res;
}

function stripFence(s: string): string {
  const t = s.trim();
  if (t.startsWith("```")) {
    return t.replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
  }
  return t;
}

/* ─────────────────────────  usage log  ─────────────────────────── */

async function logUsage(
  task: string,
  provider: string,
  model: string,
  usage: { input?: number; output?: number },
): Promise<void> {
  try {
    const file = path.join(process.cwd(), ".data", "usage.jsonl");
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.appendFile(
      file,
      JSON.stringify({
        ts: Date.now(),
        task,
        provider,
        model,
        input: usage.input ?? 0,
        output: usage.output ?? 0,
      }) + "\n",
    );
  } catch {
    /* best effort */
  }
}
