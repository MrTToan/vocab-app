import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import type { z } from "zod";
import { currentUserId, resolveIsOwner, UnauthorizedError } from "@/lib/auth/user";
import { isRateLimitError } from "@/lib/auth/quota";

/*
 * The single wrapper every API route goes through (except NextAuth's own
 * /api/auth/[...nextauth]). It centralizes, in order:
 *
 *   1. Origin check (state-changing methods only): if an `Origin` header is
 *      present and its host differs from the request host
 *      (X-Forwarded-Host/Host), the request is rejected with 403. Same-origin
 *      fetches (and requests without an Origin header, e.g. curl) pass.
 *   2. Auth: `currentUserId()` -> 401 {error:"unauthorized"} when signed out.
 *      `withOwner` additionally requires the caller to be the site owner
 *      (legacy `local-user` id or an OWNER_EMAILS account) -> 403 otherwise.
 *   3. Body size cap: a JSON body over `maxBytes` (default 256 KB) -> 413,
 *      checked via Content-Length first and the measured text as fallback,
 *      BEFORE JSON.parse ever runs.
 *   4. Validation: POST/PATCH/PUT bodies (and GET/DELETE searchParams) are
 *      parsed with the route's zod schema -> 400 {error, issues} on failure.
 *   5. Error mapping: QuotaError/BurstError -> 429, ForbiddenError /
 *      PromptForbiddenError -> 403, UnauthorizedError -> 401, anything else ->
 *      500 {error:"Something went wrong", id} with the detail logged
 *      server-side under that id (never echoed to the client).
 *
 * Handlers receive { userId, owner, input, req, params } and return either a
 * Response/NextResponse (passed through) or a JSON-able object (200).
 */

/** Default JSON body ceiling. Routes accepting base64 images override it. */
export const MAX_JSON_BYTES = 256 * 1024;

/**
 * The one cache policy for MUTABLE per-user JSON GETs — any endpoint whose data
 * a button (a mutation) can change: the collections list, runtime config, etc.
 *
 * It must never let the browser serve a STALE response to SWR's post-mutation
 * revalidation. A positive `max-age` did exactly that: after a successful write
 * the refetch was answered from the browser's HTTP cache with the pre-write body
 * for up to 30s, so the click "did nothing" (the /vocab make-public/private
 * toggle, collection rename/delete, the admin LLM toggle — a whole class). Any
 * `max-age`/`s-maxage`/`stale-while-revalidate` on this kind of data reopens the
 * class, so keep it `no-store`. `private` also keeps shared proxies (Cloudflare)
 * from caching per-session data. Reach for this on every mutable-data GET; use a
 * long `max-age` only for genuinely immutable, content-addressed bytes.
 */
export const MUTABLE_JSON_CACHE_HEADERS = {
  "Cache-Control": "private, no-store",
} as const;

export interface HandlerCtx<I, P> {
  userId: string;
  /** Site owner (legacy `local-user` or an OWNER_EMAILS account), resolved once per request. */
  owner: boolean;
  input: I;
  req: Request;
  params: P;
}

type HandlerResult = Response | object | null;
type Handler<I, P> = (ctx: HandlerCtx<I, P>) => Promise<HandlerResult> | HandlerResult;

type Params = Record<string, string>;
type RouteCtx<P extends Params> = { params: Promise<P> };
export type WrappedRoute<P extends Params = Params> = (
  req: Request,
  ctx?: RouteCtx<P>,
) => Promise<Response>;

interface WrapOpts {
  /** Override the JSON body size cap (bytes). */
  maxBytes?: number;
}

function json(status: number, body: unknown): NextResponse {
  return NextResponse.json(body, { status });
}

/** True when an Origin header is present and does not match the request host. */
function isCrossOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin || origin === "null") return origin === "null";
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return true; // malformed Origin -> reject
  }
  const forwarded = req.headers.get("x-forwarded-host");
  const host = (forwarded ? forwarded.split(",")[0] : req.headers.get("host")) ?? "";
  return !host || originHost.toLowerCase() !== host.trim().toLowerCase();
}

type ReadResult<I> = { ok: true; input: I } | { ok: false; res: Response };

async function readInput<S extends z.ZodType>(
  req: Request,
  schema: S,
  maxBytes: number,
): Promise<ReadResult<z.output<S>>> {
  const method = req.method.toUpperCase();
  let raw: unknown;
  if (method === "POST" || method === "PATCH" || method === "PUT") {
    const len = Number(req.headers.get("content-length"));
    if (Number.isFinite(len) && len > maxBytes) {
      return { ok: false, res: json(413, { error: "Request body too large" }) };
    }
    let text: string;
    try {
      text = await req.text();
    } catch {
      return { ok: false, res: json(400, { error: "Invalid request body", issues: [] }) };
    }
    if (Buffer.byteLength(text, "utf8") > maxBytes) {
      return { ok: false, res: json(413, { error: "Request body too large" }) };
    }
    if (text.trim() === "") {
      raw = {}; // bodyless POST (e.g. adopt) validates against its schema
    } else {
      try {
        raw = JSON.parse(text);
      } catch {
        return { ok: false, res: json(400, { error: "Invalid JSON body", issues: [] }) };
      }
    }
  } else {
    // GET/DELETE: validate the query string the same way.
    raw = Object.fromEntries(new URL(req.url).searchParams);
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => ({
      path: i.path.join("."),
      code: i.code,
      message: i.message,
    }));
    return {
      ok: false,
      res: json(400, { error: issues[0]?.message ?? "Invalid request", issues }),
    };
  }
  return { ok: true, input: parsed.data };
}

/** The store layers' edit-permission errors (lib/store.ts ForbiddenError,
 *  lib/writing/store.ts PromptForbiddenError), matched by name so the wrapper
 *  needs no hard import of either store module. */
function isForbiddenError(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === "ForbiddenError" || err.name === "PromptForbiddenError")
  );
}

function mapError(err: unknown): Response {
  if (isRateLimitError(err)) return json(429, { error: err.message });
  // Feature caps (lib/classes/config.ts ClassCapError, lib/assignments/config.ts
  // AssignmentCapError) → 409, matched by name so the wrapper needs no hard import
  // of those modules. The message is user-facing, unlike the opaque 403/500.
  if (err instanceof Error && (err.name === "ClassCapError" || err.name === "AssignmentCapError")) {
    return json(409, { error: err.message });
  }
  // Assignment create input error (bad content ref / no valid students) → 400
  // with the user-facing message, matched by name.
  if (err instanceof Error && err.name === "AssignmentInputError") {
    return json(400, { error: err.message });
  }
  if (isForbiddenError(err)) {
    return json(403, { error: "forbidden" });
  }
  if (err instanceof UnauthorizedError) return json(401, { error: "unauthorized" });
  const id = randomUUID().slice(0, 8);
  console.error(`[api ${id}]`, err);
  return json(500, { error: "Something went wrong", id });
}

function wrap<S extends z.ZodType, P extends Params>(
  schema: S,
  handler: Handler<z.output<S>, P>,
  requireOwner: boolean,
  opts: WrapOpts = {},
): WrappedRoute<P> {
  return async (req: Request, ctx?: RouteCtx<P>): Promise<Response> => {
    try {
      const method = req.method.toUpperCase();
      if (method !== "GET" && method !== "HEAD" && isCrossOrigin(req)) {
        return json(403, { error: "forbidden" });
      }
      const userId = await currentUserId();
      if (!userId) return json(401, { error: "unauthorized" });
      const owner = await resolveIsOwner(userId);
      if (requireOwner && !owner) return json(403, { error: "forbidden" });
      const read = await readInput(req, schema, opts.maxBytes ?? MAX_JSON_BYTES);
      if (!read.ok) return read.res;
      const params = ((await ctx?.params) ?? {}) as P;
      const out = await handler({ userId, owner, input: read.input, req, params });
      return out instanceof Response ? out : NextResponse.json(out ?? {});
    } catch (err) {
      return mapError(err);
    }
  };
}

/** Wrap a route that requires a signed-in user. */
export function withUser<S extends z.ZodType, P extends Params = Params>(
  schema: S,
  handler: Handler<z.output<S>, P>,
  opts?: WrapOpts,
): WrappedRoute<P> {
  return wrap(schema, handler, false, opts);
}

/** Wrap an owner-only route (admin stats, question import, prompt publish). */
export function withOwner<S extends z.ZodType, P extends Params = Params>(
  schema: S,
  handler: Handler<z.output<S>, P>,
  opts?: WrapOpts,
): WrappedRoute<P> {
  return wrap(schema, handler, true, opts);
}
