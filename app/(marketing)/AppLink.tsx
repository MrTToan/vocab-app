"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { signInHref } from "@/lib/signin";
import { useSignedOut } from "./useSignedOut";

/*
 * A landing-page CTA into a gated app route. Signed-in visitors (and local dev
 * with no auth configured) get a plain <Link> straight to `to`. A signed-out
 * visitor gets the Auth.js Google sign-in URL with `callbackUrl=to`, so the CTA
 * no longer bounces through proxy.ts back to this same page (`/?signin=1`).
 * See useSignedOut for the fail-open rule.
 */
export default function AppLink({
  to,
  className,
  children,
}: {
  to: string;
  className?: string;
  children: ReactNode;
}) {
  const signedOut = useSignedOut();
  if (signedOut) {
    return (
      // An Auth.js API endpoint, not a page — <Link> client-navigation doesn't apply.
      // eslint-disable-next-line @next/next/no-html-link-for-pages
      <a href={signInHref(to)} className={className}>
        {children}
      </a>
    );
  }
  return (
    <Link href={to} className={className}>
      {children}
    </Link>
  );
}
