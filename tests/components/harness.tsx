import type { ReactElement } from "react";
import { render } from "@testing-library/react";
import { SWRConfig } from "swr";
import { vi } from "vitest";

/**
 * Shared harness for the jsdom component tests. No MSW yet — a plain `vi` fetch
 * stub routes `/api/*` calls, and every render gets a FRESH, isolated SWR cache
 * (`provider: () => new Map()`, no deduping) so one test's cache never leaks
 * into the next.
 */

export type RouteResult =
  | unknown
  | { status?: number; body?: unknown };

/** How a request is described to a route matcher. */
export type MatchedRequest = { url: string; path: string; method: string; body: unknown };

/**
 * A route table: each key is `"<METHOD> <path>"` (path matched by prefix, so
 * `"GET /api/words"` catches every `?fields=list&…` page). The value is either a
 * literal body or a function of the request. Return a `{ status, body }` object
 * to drive a non-200 (error-path) response.
 */
export type Routes = Record<
  string,
  RouteResult | ((req: MatchedRequest) => RouteResult)
>;

function makeResponse(result: RouteResult): Response {
  let status = 200;
  let body: unknown = result;
  if (
    result &&
    typeof result === "object" &&
    ("status" in (result as object) || "body" in (result as object))
  ) {
    const r = result as { status?: number; body?: unknown };
    status = r.status ?? 200;
    body = r.body ?? {};
  }
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    arrayBuffer: async () => new ArrayBuffer(0),
    blob: async () => new Blob([]),
    headers: new Headers(),
  } as unknown as Response;
}

/**
 * Install a `global.fetch` stub over a route table and return the mock plus a
 * `calls` reader. Unmatched routes reject loudly so a missing stub is obvious.
 */
export function mockFetch(routes: Routes) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = (init?.method ?? "GET").toUpperCase();
    const path = url.split("?")[0];
    let body: unknown = undefined;
    if (typeof init?.body === "string") {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    const reqInfo: MatchedRequest = { url, path, method, body };

    // Longest matching prefix wins, so a specific route beats a general one.
    const match = Object.keys(routes)
      .filter((k) => {
        const [m, p] = k.split(" ");
        return m === method && path.startsWith(p);
      })
      .sort((a, b) => b.split(" ")[1].length - a.split(" ")[1].length)[0];

    if (!match) {
      throw new Error(`No route stub for ${method} ${path}`);
    }
    const handler = routes[match];
    const result =
      typeof handler === "function"
        ? (handler as (r: MatchedRequest) => RouteResult)(reqInfo)
        : handler;
    return makeResponse(result);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** Render a component with an isolated SWR cache (no cross-test leakage). */
export function renderWithSWR(ui: ReactElement) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      {ui}
    </SWRConfig>,
  );
}
