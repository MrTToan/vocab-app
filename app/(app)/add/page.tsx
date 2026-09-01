"use client";

import { useEffect, useState } from "react";
import AddWord from "@/components/vocab/AddWord";
import ImportWords from "@/components/vocab/ImportWords";

type Tab = "single" | "import";

/**
 * Combined "Add" page: one nav entry that hosts both ways to add words — a
 * single word (with live duplicate check + enrichment) and a bulk CSV import.
 * The old /import route redirects here with ?tab=import so its deep-links still
 * open straight on the importer.
 */
export default function AddPage() {
  const [tab, setTab] = useState<Tab>("single");

  // Honour ?tab=import (used by the /import → /add redirect and any deep-link).
  useEffect(() => {
    try {
      const t = new URLSearchParams(window.location.search).get("tab");
      if (t === "import") setTab("import");
    } catch {
      /* ignore */
    }
  }, []);

  function select(next: Tab) {
    setTab(next);
    // Keep the URL honest without a navigation, so a refresh/bookmark reopens
    // the same tab.
    try {
      const url = new URL(window.location.href);
      if (next === "import") url.searchParams.set("tab", "import");
      else url.searchParams.delete("tab");
      window.history.replaceState(null, "", url);
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-extrabold">Add words</h1>

      <div
        className="inline-flex p-1 rounded-xl border"
        style={{ borderColor: "var(--line)" }}
        role="tablist"
        aria-label="How to add words"
      >
        <TabButton on={tab === "single"} onClick={() => select("single")}>
          ＋ Single word
        </TabButton>
        <TabButton on={tab === "import"} onClick={() => select("import")}>
          ⇪ Import CSV
        </TabButton>
      </div>

      {tab === "single" ? <AddWord /> : <ImportWords />}
    </div>
  );
}

function TabButton({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={on}
      onClick={onClick}
      className="px-4 py-1.5 rounded-lg text-sm font-bold whitespace-nowrap transition-colors"
      style={
        on
          ? { background: "var(--accent)", color: "var(--accent-ink)" }
          : { color: "var(--muted)" }
      }
    >
      {children}
    </button>
  );
}
