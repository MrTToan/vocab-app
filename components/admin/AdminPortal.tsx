"use client";

import { useEffect, useState } from "react";
import AdminDashboard from "./AdminDashboard";
import WritingQuestionsAdmin from "./WritingQuestionsAdmin";

/*
 * Owner-only admin portal shell. Hosts the existing metrics dashboard and the
 * new "Writing Questions" management subtab under one tabbed surface. Only ever
 * rendered for the owner (the /admin server page gates before rendering it).
 *
 * The active tab is reflected in `?tab=` so links can deep-link to a subtab
 * (e.g. the retired /writing/add route redirects admins to ?tab=writing).
 */

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "writing", label: "Writing Questions" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

function readTab(): TabKey {
  if (typeof window === "undefined") return "overview";
  const t = new URLSearchParams(window.location.search).get("tab");
  return TABS.some((x) => x.key === t) ? (t as TabKey) : "overview";
}

export default function AdminPortal() {
  const [tab, setTab] = useState<TabKey>("overview");

  // Honour a ?tab= deep link once mounted (SSR renders the default).
  useEffect(() => setTab(readTab()), []);

  function pick(next: TabKey) {
    setTab(next);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      if (next === "overview") url.searchParams.delete("tab");
      else url.searchParams.set("tab", next);
      window.history.replaceState(null, "", url);
    }
  }

  return (
    <div className="space-y-5">
      <div
        className="flex gap-1 border-b overflow-x-auto"
        style={{ borderColor: "var(--line)" }}
        role="tablist"
        aria-label="Admin sections"
      >
        {TABS.map((t) => {
          const on = tab === t.key;
          return (
            <button
              key={t.key}
              role="tab"
              aria-selected={on}
              onClick={() => pick(t.key)}
              className="px-3.5 py-2 text-sm font-semibold whitespace-nowrap -mb-px border-b-2 transition-colors"
              style={
                on
                  ? { borderColor: "var(--accent)", color: "var(--accent)" }
                  : { borderColor: "transparent", color: "var(--muted)" }
              }
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === "overview" ? <AdminDashboard /> : <WritingQuestionsAdmin />}
    </div>
  );
}
