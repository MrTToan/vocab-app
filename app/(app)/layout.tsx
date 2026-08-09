import Nav from "@/components/Nav";
import AuthStatus from "@/components/AuthStatus";

// The in-app chrome: shared nav + a centered content column. Wraps every route
// except the marketing landing page. AuthStatus (a server component) is passed
// into the nav; it renders nothing until auth is configured.
export default function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      <Nav authSlot={<AuthStatus />} />
      <main className="flex-1 w-full max-w-3xl mx-auto px-4 py-8">{children}</main>
    </>
  );
}
