"use client";

import { useSearchParams } from "next/navigation";

/*
 * Shown when the sign-in proxy (proxy.ts) bounced a signed-out visitor off an
 * app route back to the landing page (`/?signin=1`). A tiny client island read
 * inside <Suspense> so the landing page itself stays statically rendered.
 * Links into the Auth.js sign-in flow; styled inline with the marketing
 * palette vars so marketing.css stays untouched.
 */
export default function SignInNote() {
  const params = useSearchParams();
  if (params.get("signin") !== "1") return null;
  return (
    // This is an Auth.js API endpoint, not a page — <Link> client-navigation doesn't apply.
    // eslint-disable-next-line @next/next/no-html-link-for-pages
    <a
      href="/api/auth/signin?callbackUrl=%2Fvocab"
      style={{
        fontSize: "12px",
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        color: "var(--gold-bright)",
        whiteSpace: "nowrap",
      }}
    >
      Please sign in to continue
    </a>
  );
}
