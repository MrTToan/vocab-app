"use client";

import { useEffect, useState } from "react";

/*
 * Three-state theme control: System → Light → Dark → System.
 * "system" removes the data-theme attribute (falls back to prefers-color-scheme);
 * "light"/"dark" force it. Choice persists in localStorage (key "lexi-theme");
 * a tiny inline script in the root layout applies it before paint (no flash).
 */
type Theme = "system" | "light" | "dark";
const NEXT: Record<Theme, Theme> = { system: "light", light: "dark", dark: "system" };
const ICON: Record<Theme, string> = { system: "🖥️", light: "☀️", dark: "🌙" };
const LABEL: Record<Theme, string> = { system: "System", light: "Light", dark: "Dark" };

function apply(t: Theme) {
  const el = document.documentElement;
  if (t === "system") delete el.dataset.theme;
  else el.dataset.theme = t;
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("system");

  useEffect(() => {
    const saved = localStorage.getItem("lexi-theme");
    setTheme(saved === "light" || saved === "dark" ? saved : "system");
  }, []);

  function cycle() {
    const next = NEXT[theme];
    setTheme(next);
    apply(next);
    try {
      if (next === "system") localStorage.removeItem("lexi-theme");
      else localStorage.setItem("lexi-theme", next);
    } catch {
      /* ignore */
    }
  }

  return (
    <button
      onClick={cycle}
      title={`Theme: ${LABEL[theme]} — click to change`}
      aria-label={`Theme: ${LABEL[theme]}. Click to change.`}
      className="px-2.5 py-1.5 rounded-lg text-sm leading-none transition-colors hover:opacity-80"
      style={{ color: "var(--muted)" }}
    >
      <span aria-hidden>{ICON[theme]}</span>
    </button>
  );
}
