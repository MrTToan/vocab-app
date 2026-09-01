import { currentUserId, isOwner } from "@/lib/auth/user";
import AdminNavLink from "@/components/AdminNavLink";

// Owner gate for the nav's Admin link. This is the ONLY auth-dependent bit of
// the app chrome, so it lives in its own async server component that the layout
// renders inside <Suspense> — the shell (and the page's loading skeleton) paint
// immediately while this resolves the session behind the fallback, instead of
// the whole app layout blocking every navigation on auth(). Non-owners and
// unauthenticated visitors render nothing (no layout shift: it's a trailing item
// in the utility cluster). The session decode is shared with AuthStatus via the
// cached getSession() (see lib/auth/user.ts).
export default async function AdminLink() {
  const userId = await currentUserId();
  if (!userId || !isOwner(userId)) return null;
  return <AdminNavLink />;
}
