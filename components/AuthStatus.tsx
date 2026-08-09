import { auth, signIn, signOut } from "@/auth";
import { authConfigured } from "@/lib/auth/user";

/*
 * Sign-in / sign-out control for the nav. Server component.
 * Renders NOTHING until Google/Auth.js credentials are configured, so local dev
 * (dev-user seam) looks exactly as before. Once AUTH_* is set it shows the
 * signed-in user + Sign out, or a Sign in button.
 */
export default async function AuthStatus() {
  if (!authConfigured()) return null;
  const session = await auth();

  if (!session?.user) {
    return (
      <form
        action={async () => {
          "use server";
          await signIn("google", { redirectTo: "/vocab" });
        }}
      >
        <button
          type="submit"
          className="px-3 py-1.5 rounded-lg text-sm font-semibold whitespace-nowrap"
          style={{ background: "var(--accent)", color: "var(--bg)" }}
        >
          Sign in
        </button>
      </form>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {session.user.image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={session.user.image}
          alt=""
          className="w-7 h-7 rounded-full"
          referrerPolicy="no-referrer"
        />
      ) : null}
      <span className="text-sm font-semibold hidden sm:inline" style={{ color: "var(--muted)" }}>
        {session.user.name ?? session.user.email}
      </span>
      <form
        action={async () => {
          "use server";
          await signOut({ redirectTo: "/" });
        }}
      >
        <button
          type="submit"
          className="px-3 py-1.5 rounded-lg text-sm font-semibold whitespace-nowrap"
          style={{ color: "var(--muted)" }}
        >
          Sign out
        </button>
      </form>
    </div>
  );
}
