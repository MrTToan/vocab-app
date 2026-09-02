import { currentUserId } from "@/lib/auth/user";
import FeedbackWidget from "@/components/FeedbackWidget";

// Sign-in gate for the floating feedback widget. Like AdminLink, this is the
// ONLY auth-dependent bit added to the app chrome, so it lives in its own async
// server component that the layout renders inside <Suspense> — the shell paints
// immediately while this resolves the session behind a null fallback, keeping
// the (app) layout non-blocking on auth. Signed-out visitors render nothing (the
// submit route is auth-gated regardless); the session decode is shared with
// AuthStatus/AdminLink via the cached getSession() (see lib/auth/user.ts).
export default async function FeedbackLauncher() {
  const userId = await currentUserId();
  if (!userId) return null;
  return <FeedbackWidget />;
}
