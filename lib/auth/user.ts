/**
 * The single choke point for "who is the caller". Every user-scoped read/write
 * resolves the caller through getUserId(); routes pass the result into
 * getStore().forUser(id) / writingStore.forUser(id) so no query is ever
 * un-scoped.
 *
 * PHASE 0/dev seam: until Google sign-in (Auth.js) is wired in Phase 1 this
 * returns the local owner, so the app behaves exactly as before against the
 * migrated DB. Phase 1 replaces the body with the Auth.js session lookup —
 * nothing else in the app needs to change.
 */

// The pre-auth owner (you). The migration assigns all existing data to this id,
// and on first Google sign-in the users row for OWNER_EMAIL reuses this id, so
// your existing ~1,128 words reunite with your real account.
export const DEV_USER_ID = "local-user";
export const OWNER_EMAIL = "vothientoan999@gmail.com";

/** True once Google/Auth.js credentials are configured (i.e. real auth is on). */
export function authConfigured(): boolean {
  return !!process.env.AUTH_GOOGLE_ID && !!process.env.AUTH_SECRET;
}

/** Resolve the current user's id, or null if unauthenticated. */
export async function currentUserId(): Promise<string | null> {
  // Dev seam: with no auth configured, the app runs as the local owner exactly
  // as before. The moment AUTH_* creds are set, real Google sessions take over.
  if (!authConfigured()) return DEV_USER_ID;
  const { auth } = await import("@/auth");
  const session = await auth();
  return (session?.user as { id?: string } | undefined)?.id ?? null;
}

/**
 * Resolve the current user's id or throw a 401-shaped error. Route handlers use
 * this at the top and let it bubble to a 401 response.
 */
export async function getUserId(): Promise<string> {
  const id = await currentUserId();
  if (!id) throw new UnauthorizedError();
  return id;
}

export class UnauthorizedError extends Error {
  constructor() {
    super("unauthorized");
    this.name = "UnauthorizedError";
  }
}
