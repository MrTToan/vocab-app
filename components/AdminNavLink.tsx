"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// The owner-only Admin link in the nav utility cluster. Split out as a client
// component so it keeps its pathname-based active styling, while the OWNER GATE
// lives in the async server component AdminLink (which decides whether to render
// this at all). See app/(app)/AdminLink.tsx.
export default function AdminNavLink() {
  const path = usePathname();
  const on = path === "/admin" || path.startsWith("/admin/");
  return (
    <Link
      href="/admin"
      title="Admin"
      className="px-2.5 sm:px-3 py-1.5 rounded-lg text-sm font-semibold whitespace-nowrap transition-colors"
      style={on ? { background: "var(--accent-soft)", color: "var(--accent)" } : { color: "var(--muted)" }}
    >
      🛠️<span className="hidden sm:inline"> Admin</span>
    </Link>
  );
}
