"use client";

import { useEffect, useState } from "react";

/*
 * Does the visitor need to sign in before entering the app? The landing page is
 * statically rendered (and the Auth.js session cookie is httpOnly), so we ask
 * Auth.js's own session endpoint once per page load, from the client.
 *
 * Fails OPEN to "not signed out": until the answer arrives, and whenever auth is
 * unconfigured (local dev seam — the endpoint errors) or the request fails, CTAs
 * keep their direct app href. That is exactly the pre-change behaviour, and the
 * proxy's `/?signin=1` notice still catches a signed-out early click. Only a
 * definitive "no session" (`null`/no user) flips CTAs to the sign-in flow.
 */

let pending: Promise<boolean> | null = null;

function fetchSignedOut(): Promise<boolean> {
  pending ??= fetch("/api/auth/session", {
    credentials: "same-origin",
    headers: { accept: "application/json" },
  })
    .then(async (res) => {
      if (!res.ok) return false;
      const body = (await res.json()) as { user?: unknown } | null;
      return !body?.user;
    })
    .catch(() => false);
  return pending;
}

/** Test seam: forget the memoised answer. */
export function __resetSignedOutCache() {
  pending = null;
}

export function useSignedOut(): boolean {
  const [signedOut, setSignedOut] = useState(false);
  useEffect(() => {
    let live = true;
    fetchSignedOut().then((v) => {
      if (live) setSignedOut(v);
    });
    return () => {
      live = false;
    };
  }, []);
  return signedOut;
}
