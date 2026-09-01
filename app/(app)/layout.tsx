import { Suspense } from "react";
import Nav from "@/components/Nav";
import AuthStatus from "@/components/AuthStatus";
import AdminLink from "./AdminLink";

// The in-app chrome: shared nav + a centered content column. Wraps every route
// except the marketing landing page.
//
// PERF: this is a SYNCHRONOUS server component so the shell (nav + the child
// route's loading.tsx skeleton) paints immediately on navigation into the group
// — it does NOT `await auth()`. If it did, a layout that reads cookies blocks
// the whole navigation until auth resolves and loading.tsx shows no fallback
// (see node_modules/next/dist/docs/.../loading.md). The two auth-dependent bits
// — AuthStatus (sign-in state) and AdminLink (owner-only) — are the ONLY things
// that need the session, so each renders inside its own <Suspense> and streams
// in behind the shell. Both share one session decode via cached getSession().
export default function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      <Nav
        authSlot={
          <Suspense fallback={null}>
            <AuthStatus />
          </Suspense>
        }
        adminSlot={
          <Suspense fallback={null}>
            <AdminLink />
          </Suspense>
        }
      />
      <main className="flex-1 w-full max-w-3xl mx-auto px-4 py-8">{children}</main>
    </>
  );
}
