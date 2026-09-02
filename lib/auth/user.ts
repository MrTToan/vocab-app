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

import { cache } from "react";
import type { Session } from "next-auth";

// The pre-auth owner (you). The migration assigns all existing data to this id,
// and on first Google sign-in the users row for OWNER_EMAIL reuses this id, so
// your existing ~1,128 words reunite with your real account.
export const DEV_USER_ID = "local-user";
export const OWNER_EMAIL = "vothientoan999@gmail.com";

// The sentinel owner of the shared/public catalog. Words and collections owned
// by this id are global content: everyone can study/read them, but only the
// owner/admin may EDIT them. A real user's personal content is owned by their
// own user id instead. See lib/store.ts for how this gates editing.
export const SYSTEM_OWNER = "__system__";

/** The comma-separated owner allow-list (env OWNER_EMAILS, defaulting to the
 *  legacy single OWNER_EMAIL), normalized to lowercase. */
export function ownerEmails(): string[] {
  return (process.env.OWNER_EMAILS ?? OWNER_EMAIL)
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

// User ids we have already resolved (via their users-row email) to be owners.
// Populated by resolveIsOwner() — the API wrapper calls it once per request
// BEFORE any handler/store code runs, so the sync isOwner() below stays
// consistent for stores that only receive a userId.
const knownOwnerIds = new Set<string>();

/** The owner/admin — the privileged account(s) (bypass quota, edit the shared
 *  catalog): the pre-auth owner (`local-user`, whose Google sign-in reclaims
 *  the same id) or any account whose email is in OWNER_EMAILS (once resolved
 *  through resolveIsOwner for the current request). */
export function isOwner(userId: string): boolean {
  return userId === DEV_USER_ID || knownOwnerIds.has(userId);
}

/**
 * Is `userId` the site owner? The legacy `local-user` id short-circuits;
 * otherwise the user's row email is looked up ONCE per request (React cache())
 * and compared to OWNER_EMAILS. A positive result is memoized process-wide so
 * the sync isOwner()/ownerIdFor()/canEdit() call sites agree within the request.
 */
export const resolveIsOwner = cache(async (userId: string): Promise<boolean> => {
  if (isOwner(userId)) return true;
  const { getUserEmail } = await import("./store");
  const email = await getUserEmail(userId);
  const owner = !!email && ownerEmails().includes(email);
  if (owner) knownOwnerIds.add(userId);
  return owner;
});

/** Which `owner_id` new content authored by this user gets. The owner authors the
 *  shared catalog (`__system__`); everyone else owns their personal content. */
export function ownerIdFor(userId: string): string {
  return isOwner(userId) ? SYSTEM_OWNER : userId;
}

/** May `userId` EDIT content/collection whose `owner_id` is `ownerId`?
 *  You can edit what you own; the owner/admin can additionally edit the shared
 *  catalog. Studying a word grants NO edit rights — this is the only gate. */
export function canEdit(userId: string, ownerId: string): boolean {
  return ownerId === userId || (ownerId === SYSTEM_OWNER && isOwner(userId));
}

/** True once Google/Auth.js credentials are configured (i.e. real auth is on). */
export function authConfigured(): boolean {
  return !!process.env.AUTH_GOOGLE_ID && !!process.env.AUTH_SECRET;
}

/**
 * Resolve the NextAuth session ONCE per request. `cache()` memoizes for the
 * lifetime of a single server request, so the several call sites that need the
 * caller (the app layout's Suspense children, AuthStatus, route handlers) share
 * one `auth()` session-decode instead of paying it each. Returns null when auth
 * is not configured (the dev seam) or there is no session.
 */
export const getSession = cache(async (): Promise<Session | null> => {
  if (!authConfigured()) return null;
  const { auth } = await import("@/auth");
  return auth();
});

/** Resolve the current user's id, or null if unauthenticated. */
export async function currentUserId(): Promise<string | null> {
  // Dev seam: with no auth configured, the app runs as the local owner exactly
  // as before. The moment AUTH_* creds are set, real Google sessions take over.
  if (!authConfigured()) return DEV_USER_ID;
  const session = await getSession();
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
