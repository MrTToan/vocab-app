import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

/*
 * Public liveness/readiness probe for the Docker Compose healthcheck and the
 * deploy script (`/api/config` went signed-in-only in #32, so the probe now
 * needs an unauthenticated endpoint). Deliberately NOT wrapped in `withUser`/
 * `lib/api.ts`: there is no user, no body and no origin to validate, and the
 * probe must never be rate-limited or redirected. It proves the process can
 * serve requests and the DB answers a trivial query, and leaks nothing else.
 */

export const dynamic = "force-dynamic";

const DB_TIMEOUT_MS = 2000;

export async function GET() {
  let ok = false;
  try {
    const db = await getDb();
    await Promise.race([
      db.execute("SELECT 1"),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("db timeout")), DB_TIMEOUT_MS).unref?.(),
      ),
    ]);
    ok = true;
  } catch {
    ok = false;
  }
  return NextResponse.json(
    { ok },
    { status: ok ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}
