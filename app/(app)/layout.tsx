import Nav from "@/components/Nav";

// The in-app chrome: shared nav + a centered content column. Wraps every route
// except the marketing landing page.
export default function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      <Nav />
      <main className="flex-1 w-full max-w-3xl mx-auto px-4 py-8">{children}</main>
    </>
  );
}
