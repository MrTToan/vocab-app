import Nav from "@/components/Nav";
import AuthStatus from "@/components/AuthStatus";
import { currentUserId, isOwner } from "@/lib/auth/user";

// The in-app chrome: shared nav + a centered content column. Wraps every route
// except the marketing landing page. AuthStatus (a server component) is passed
// into the nav; it renders nothing until auth is configured. The Admin link is
// resolved server-side and shown only to the owner (non-owners see no change).
export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const userId = await currentUserId();
  const showAdmin = !!userId && isOwner(userId);
  return (
    <>
      <Nav authSlot={<AuthStatus />} showAdmin={showAdmin} />
      <main className="flex-1 w-full max-w-3xl mx-auto px-4 py-8">{children}</main>
    </>
  );
}
