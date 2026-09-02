/*
 * Shared builders for route tests: plain Requests aimed at the exported route
 * handlers (no server), plus the standard wrapper probes — oversized body (413)
 * and cross-origin state-changing request (403).
 */

const JSON_HEADERS = { "content-type": "application/json" };

export function req(
  url: string,
  method: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Request {
  return new Request(url, {
    method,
    headers: { ...JSON_HEADERS, ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export const get = (url: string) => new Request(url);
export const post = (url: string, body?: unknown, headers: Record<string, string> = {}) =>
  req(url, "POST", body, headers);
export const patch = (url: string, body?: unknown, headers: Record<string, string> = {}) =>
  req(url, "PATCH", body, headers);
export const del = (url: string) => new Request(url, { method: "DELETE" });

/** A syntactically valid JSON body padded past the wrapper's size cap. */
export function oversized(url: string, method = "POST", bytes = 300 * 1024): Request {
  return new Request(url, {
    method,
    headers: JSON_HEADERS,
    body: `{"pad":"${"x".repeat(bytes)}"}`,
  });
}

/** A state-changing request carrying a foreign Origin header. */
export function crossOrigin(url: string, method = "POST", body: unknown = {}): Request {
  return req(url, method, body, { origin: "https://evil.example" });
}

/** Next 16 route ctx: `params` is a Promise. */
export const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

/** Assert the standard 400 shape: { error, issues: [...] }. */
export async function expectIssues(res: Response): Promise<void> {
  if (res.status !== 400) throw new Error(`expected 400, got ${res.status}`);
  const body = (await res.json()) as { error?: string; issues?: unknown[] };
  if (typeof body.error !== "string" || !Array.isArray(body.issues)) {
    throw new Error(`expected {error, issues}, got ${JSON.stringify(body)}`);
  }
}
