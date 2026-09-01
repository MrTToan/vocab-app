"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import ThemeToggle from "./ThemeToggle";

// Two peer modules. The nav shows a module switch (Vocabulary | Writing) plus a
// context sub-nav for whichever module you're in. Vocab keeps all its original
// URLs; writing lives under /writing.
const MODULES = [
  { key: "vocab", label: "Vocabulary", href: "/vocab" },
  { key: "writing", label: "Writing", href: "/writing" },
] as const;

const SUBNAV: Record<string, { href: string; label: string }[]> = {
  vocab: [
    { href: "/vocab", label: "Home" },
    { href: "/practice", label: "Practice" },
    { href: "/library", label: "Library" },
    { href: "/collections", label: "Collections" },
    { href: "/add", label: "Add" },
    { href: "/import", label: "Import" },
  ],
  writing: [
    { href: "/writing", label: "Overview" },
    { href: "/writing/task1", label: "Task 1" },
    { href: "/writing/task2", label: "Task 2" },
  ],
};

function moduleOf(path: string): "vocab" | "writing" {
  return path === "/writing" || path.startsWith("/writing/") ? "writing" : "vocab";
}

// `authSlot` is a server component (AuthStatus) passed in by the layout — a
// client component can still render server nodes it receives as props.
export default function Nav({ authSlot, showAdmin }: { authSlot?: ReactNode; showAdmin?: boolean }) {
  const path = usePathname();
  const active = moduleOf(path);

  return (
    <header
      className="w-full border-b sticky top-0 z-10 backdrop-blur"
      style={{ borderColor: "var(--line)", background: "color-mix(in srgb, var(--bg) 85%, transparent)" }}
    >
      {/* Row 1 — brand + module switch */}
      <div className="max-w-3xl mx-auto px-4 h-14 flex items-center gap-2">
        <Link href="/" className="font-extrabold tracking-tight mr-2 text-lg">
          Lexi
        </Link>
        <div className="flex items-center gap-1">
          {MODULES.map((m) => {
            const on = active === m.key;
            return (
              <Link
                key={m.key}
                href={m.href}
                className="px-3 py-1.5 rounded-lg text-sm font-bold whitespace-nowrap transition-colors"
                style={
                  on
                    ? { background: "var(--accent)", color: "var(--accent-ink)" }
                    : { color: "var(--muted)" }
                }
              >
                {m.label}
              </Link>
            );
          })}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Link
            href="/report"
            className="px-3 py-1.5 rounded-lg text-sm font-semibold whitespace-nowrap transition-colors"
            style={
              path === "/report"
                ? { background: "var(--accent-soft)", color: "var(--accent)" }
                : { color: "var(--muted)" }
            }
          >
            📊 Report
          </Link>
          {showAdmin && (
            <Link
              href="/admin"
              className="px-3 py-1.5 rounded-lg text-sm font-semibold whitespace-nowrap transition-colors"
              style={
                path === "/admin" || path.startsWith("/admin/")
                  ? { background: "var(--accent-soft)", color: "var(--accent)" }
                  : { color: "var(--muted)" }
              }
            >
              🛠️ Admin
            </Link>
          )}
          <ThemeToggle />
          {authSlot}
        </div>
      </div>

      {/* Row 2 — sub-nav for the active module */}
      <nav className="max-w-3xl mx-auto px-4 h-11 flex items-center gap-1 border-t" style={{ borderColor: "var(--line)" }}>
        <div className="flex items-center gap-1 overflow-x-auto">
          {SUBNAV[active].map((l) => {
            const on = path === l.href;
            return (
              <Link
                key={l.href}
                href={l.href}
                className="px-3 py-1.5 rounded-lg text-sm font-semibold whitespace-nowrap transition-colors"
                style={
                  on
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
