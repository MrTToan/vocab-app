import Anthropic from "@anthropic-ai/sdk";
import { promises as fs } from "fs";
import path from "path";

/*
 * LLM provider layer with a PRIORITY FALLBACK CHAIN.
 *
 * You define an ordered list of providers (your preference). The app uses the
 * first one. If it fails 3 times IN A ROW, the app permanently drops to the next
 * one (until you restart). One global chain applies to every task.
 *
 * Config (in .env.local) — numbered entries, in priority order:
 *   LLM_1_PROVIDER=openai
 *   LLM_1_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai/
 *   LLM_1_API_KEY=...            LLM_1_MODEL=gemini-flash-latest
 *   LLM_2_PROVIDER=openai
 *   LLM_2_BASE_URL=https://api.openai.com/v1
 *   LLM_2_API_KEY=...            LLM_2_MODEL=gpt-4o-mini
 *   LLM_3_PROVIDER=anthropic
 *   LLM_3_API_KEY=sk-ant-...     LLM_3_MODEL=claude-sonnet-5
 *
 * Back-compat (no numbered entries): single custom (LLM_MODE=custom + LLM_*) or
 * default Anthropic (ANTHROPIC_API_KEY, Haiku for enrich/generate, Sonnet for score).
 */

export type Task = "enrich" | "generate" | "score";
export type ProviderName = "anthropic" | "openai";

interface TaskConfig {
  provider: ProviderName;
  model: string;
  apiKey: string;
  baseUrl?: string;
}

const FAIL_THRESHOLD = 3;

const DEFAULT_ANTHROPIC_MODEL: Record<Task, string> = {
  enrich: "claude-haiku-4-5",
  generate: "claude-haiku-4-5",
  score: "claude-sonnet-5",
};

function env(...names: string[]): string | undefined {
  for (const n of names) {
    const v = process.env[n];
    if (v && v.trim()) return v.trim();
  }
  return undefined;
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
      env(`LLM_${i}_MODEL`),
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
  return (["enrich", "generate", "score"] as Task[]).some(hasProvider);
}
export function mode(): "default" | "custom" | "chain" {
  if (numberedChain("enrich").length) return "chain";
  if ((process.env.LLM_MODE || "").toLowerCase() === "custom") return "custom";
  return "default";
}

/* ─────────────────  circuit-breaker state (per process)  ───────── */
// Strict: advance only after FAIL_THRESHOLD consecutive failures; never auto-recover
// (resets only on restart), per the chosen behavior.

let activeIndex = 0;
let consecutiveFailures = 0;

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

/* ─────────────────────────  the call  ─────────────────────────── */

export async function callStructured(
  task: Task,
  opts: { system: string; user: string; schema: unknown; maxTokens: number },
): Promise<unknown> {
  const chain = resolveChain(task);
  if (!chain.length) throw new Error(`No LLM configured for "${task}"`);

  const idx = Math.min(activeIndex, chain.length - 1);
  const cfg = chain[idx];
  try {
    const result =
      cfg.provider === "anthropic"
        ? await anthropicStructured(task, cfg, opts)
        : await openaiStructured(task, cfg, opts);
    consecutiveFailures = 0; // success on the active provider resets the counter
    return result;
  } catch (err) {
    consecutiveFailures++;
    // strict: this request still fails; after 3 in a row, permanently drop down
    if (consecutiveFailures >= FAIL_THRESHOLD && activeIndex < chain.length - 1) {
      activeIndex++;
      consecutiveFailures = 0;
      const next = chain[activeIndex];
      console.warn(
        `[llm] provider #${idx + 1} (${cfg.provider}/${cfg.model}) failed ` +
          `${FAIL_THRESHOLD}x in a row — falling back to #${activeIndex + 1} ` +
          `(${next.provider}/${next.model}). Reason: ${errMsg(err)}`,
      );
    }
    throw err;
  }
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/* ── Anthropic ── */

const anthropicClients = new Map<string, Anthropic>();
function anthropicClient(apiKey: string): Anthropic {
  let c = anthropicClients.get(apiKey);
  if (!c) {
    c = new Anthropic({ apiKey });
    anthropicClients.set(apiKey, c);
  }
  return c;
}

async function anthropicStructured(
  task: Task,
  cfg: TaskConfig,
  { system, user, schema, maxTokens }: { system: string; user: string; schema: unknown; maxTokens: number },
): Promise<unknown> {
  const resp = await anthropicClient(cfg.apiKey).messages.create({
    model: cfg.model,
    max_tokens: maxTokens,
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    output_config: { format: { type: "json_schema", schema } },
    messages: [{ role: "user", content: user }],
  } as any);
  logUsage(task, "anthropic", cfg.model, {
    input: (resp as any).usage?.input_tokens,
    output: (resp as any).usage?.output_tokens,
  });
  const textBlock = resp.content.find((b: any) => b.type === "text") as
    | { text: string }
    | undefined;
  if (!textBlock) throw new Error("Anthropic returned no text block");
  return JSON.parse(textBlock.text);
}

/* ── OpenAI-compatible ── */

async function openaiStructured(
  task: Task,
  cfg: TaskConfig,
  { system, user, schema, maxTokens }: { system: string; user: string; schema: unknown; maxTokens: number },
): Promise<unknown> {
  const messages = [
    {
      role: "system",
      content: `${system}\n\nReturn ONLY a single JSON object (no markdown, no prose) matching this JSON schema:\n${JSON.stringify(schema)}`,
    },
    { role: "user", content: user },
  ];

  let res = await openaiPost(cfg, messages, maxTokens, {
    type: "json_schema",
    json_schema: { name: "result", strict: true, schema },
  });
  if (!res.ok && (res.status === 400 || res.status === 422)) {
    res = await openaiPost(cfg, messages, maxTokens, { type: "json_object" });
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`LLM HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  const data: any = await res.json();
  logUsage(task, "openai", cfg.model, {
    input: data.usage?.prompt_tokens,
    output: data.usage?.completion_tokens,
  });
  const content: string = data.choices?.[0]?.message?.content ?? "";
  if (!content.trim()) throw new Error("LLM returned empty content");
  return JSON.parse(stripFence(content));
}

function openaiPost(
  cfg: TaskConfig,
  messages: unknown,
  maxTokens: number,
  responseFormat: unknown,
): Promise<Response> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cfg.apiKey) headers["Authorization"] = `Bearer ${cfg.apiKey}`;
  return fetch(`${cfg.baseUrl!.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: cfg.model,
      max_tokens: maxTokens,
      messages,
      response_format: responseFormat,
    }),
  });
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
