import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// Regression guard for the in-app navigation-latency fix (see PR "Speed up
// in-app navigation"). Perceived nav speed can't be unit-tested directly, so we
// pin the two structural invariants that made navigation into the (app) group
// paint instantly instead of blocking ~500-700ms on per-request auth:
//   1. The (app) route group has a loading.tsx boundary (instant skeleton +
//      a target for <Link> prefetch).
//   2. The (app) layout does NOT block its whole render on auth — it must not
//      `await currentUserId()`/auth() at the top; the auth-dependent bits are
//      Suspense-wrapped so the shell streams first. A layout that reads cookies
//      up front re-blocks navigation and suppresses the loading fallback.
const root = join(__dirname, "..");
const appGroup = join(root, "app", "(app)");

describe("(app) navigation loading boundary", () => {
  it("has a loading.tsx for the (app) route group", () => {
    expect(existsSync(join(appGroup, "loading.tsx"))).toBe(true);
  });

  it("(app) layout does not block the whole tree on auth", () => {
    const layout = readFileSync(join(appGroup, "layout.tsx"), "utf8");
    // The layout component itself must be synchronous (no top-level await of
    // the session) so the shell + loading skeleton paint immediately.
    expect(layout).not.toMatch(/export default async function/);
    expect(layout).not.toMatch(/await\s+currentUserId\s*\(/);
    // Auth-dependent chrome streams in behind a Suspense boundary instead.
    expect(layout).toMatch(/Suspense/);
  });
});
