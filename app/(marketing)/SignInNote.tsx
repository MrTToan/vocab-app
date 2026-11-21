"use client";

import { useSearchParams } from "next/navigation";
import { NEXT_PARAM, safeCallbackPath, signInHref } from "@/lib/signin";

/*
 * Shown when the sign-in proxy (proxy.ts) bounced a signed-out visitor off a
 * deep link to an app route back to the landing page (`/?signin=1&next=/vocab`).
 * An inline notice BELOW the nav (not squeezed into the nav row, where it used to
 * collide with the wordmark on phones) with a real "Continue with Google" button
 * that returns to the page they asked for. A tiny client island read inside
 * <Suspense> so the landing page itself stays statically rendered. Styles:
 * `.signin-note` in marketing.css.
 */
export default function SignInNote() {
  const params = useSearchParams();
  if (params.get("signin") !== "1") return null;
  const next = safeCallbackPath(params.get(NEXT_PARAM));
  return (
    <div className="signin-note" role="status">
      <p>
        <strong>Sign in to continue.</strong> That page is part of the Lexi app — sign in with
        Google and we&rsquo;ll take you straight there.
      </p>
      {/* An Auth.js API endpoint, not a page — <Link> client-navigation doesn't apply. */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a className="signin-btn" href={signInHref(next)}>
        Continue with Google →
      </a>
    </div>
  );
}
