import { NextResponse } from "next/server";
import { withUser, MUTABLE_JSON_CACHE_HEADERS } from "@/lib/api";
import { emptySchema } from "@/lib/api-schemas";
import { getStore } from "@/lib/store";
import { hasAnyLLM, mode, chainStatus } from "@/lib/providers";

/**
 * Runtime config for the UI (signed-in only). Everyone gets `hasLLM` (features
 * toggle on it). The diagnostic detail — storage backend and the provider/model
 * chain — is OWNER-ONLY: it names infrastructure and vendors, which end users
 * never need to see. Non-owners receive `owner: false` and none of those fields.
 */
// Mutable per-user data (the owner's admin LLM toggle changes `active`/`chain`,
// and `owner`/`hasLLM` gate features): `no-store` so a revalidation after such a
// change is never answered stale from the browser cache. See
// MUTABLE_JSON_CACHE_HEADERS for the shared policy and why.
const CACHE_HEADERS = MUTABLE_JSON_CACHE_HEADERS;

export const GET = withUser(emptySchema, async ({ owner }) => {
  const hasLLM = hasAnyLLM();
  if (!owner) return NextResponse.json({ hasLLM, owner: false }, { headers: CACHE_HEADERS });

  const { active, chain } = chainStatus();
  return NextResponse.json(
    {
      hasLLM,
      owner: true,
      backend: getStore().backend(), // "sheet" | "sqlite"
      mode: mode(), // "default" | "custom" | "chain"
      active, // index of the provider currently in use
      chain, // ordered [{ provider, model }] (no keys)
    },
    { headers: CACHE_HEADERS },
  );
});
