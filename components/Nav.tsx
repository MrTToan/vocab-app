"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Home" },
  { href: "/practice", label: "Practice" },
  { href: "/progress", label: "Progress" },
  { href: "/library", label: "Library" },
  { href: "/add", label: "Add" },
  { href: "/import", label: "Import" },
];

export default function Nav() {
  const path = usePathname();
  return (
    <header
      className="w-full border-b sticky top-0 z-10 backdrop-blur"
      style={{ borderColor: "var(--line)", background: "color-mix(in srgb, var(--bg) 85%, transparent)" }}
    >
      <nav className="max-w-3xl mx-auto px-4 h-14 flex items-center gap-1">
        <Link href="/" className="font-extrabold tracking-tight mr-3 text-lg">
          Lexi
        </Link>
        <div className="flex items-center gap-1 overflow-x-auto">
          {LINKS.slice(1).map((l) => {
            const active = path === l.href;
            return (
              <Link
                key={l.href}
                href={l.href}
                className="px-3 py-1.5 rounded-lg text-sm font-semibold whitespace-nowrap transition-colors"
                style={
                  active
                    ? { background: "var(--accent-soft)", color: "var(--accent)" }
                    : { color: "var(--muted)" }
                }
              >
                {l.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </header>
  );
}
