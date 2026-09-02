import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { upsertUser } from "@/lib/auth/store";

/*
 * NextAuth v5 config. Google-only, JWT sessions (no DB session table).
 * ENFORCEMENT lives in route handlers via currentUserId() in lib/auth/user.ts,
 * the pattern the Next 16 auth guide recommends. proxy.ts additionally does a
 * cookie-PRESENCE redirect for signed-out visitors on app pages — pure UX, no
 * JWT decode, and no substitute for the route-handler gate.
 *
 * Provider credentials are read from env by NextAuth automatically:
 *   AUTH_GOOGLE_ID, AUTH_GOOGLE_SECRET, AUTH_SECRET, AUTH_URL.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Google],
  session: { strategy: "jwt" },
  callbacks: {
    // On sign-in map the Google identity to our stable DB user id and stash it
    // on the token so every request can resolve it without a DB session lookup.
    async jwt({ token, profile }) {
      if (profile?.email) {
        token.uid = await upsertUser({
          email: profile.email,
          name: (profile.name as string) ?? null,
          image: (profile.picture as string) ?? null,
        });
      }
      return token;
    },
    async session({ session, token }) {
      if (token.uid && session.user) {
        (session.user as { id?: string }).id = token.uid as string;
      }
      return session;
    },
  },
});
