import { NextResponse } from "next/server";
import { withUser } from "@/lib/api";
import { emptySchema } from "@/lib/api-schemas";
import { getStore } from "@/lib/store";
import { hasAnyLLM, mode, chainStatus } from "@/lib/providers";

/**
 * Runtime config for the UI (signed-in only). Everyone gets `hasLLM` (features
 * toggle on it). The diagnostic detail — storage backend and the provider/model
 * chain — is OWNER-ONLY: it names infrastructure and vendors, which end users
 * never need to see. Non-owners receive `owner: false` and none of those fields.
 */
// Read-mostly JSON: let the BROWSER reuse it briefly across in-app navigations.
// `private` keeps Cloudflare/CDNs from ever caching it (it varies by session).
const CACHE_HEADERS = { "Cache-Control": "private, max-age=30, stale-while-revalidate=300" };

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
