"use client";

import { useEffect, useState } from "react";
import AddWord from "@/components/vocab/AddWord";
import PasteImport from "@/components/vocab/PasteImport";
import NewCollection from "@/components/vocab/NewCollection";

type Tab = "single" | "import" | "collection";

/**
 * Combined "Add" page: one nav entry that hosts the ways to add things — a
 * single word (with live duplicate check + enrichment), a paste-a-list bulk
 * import (parse, dedupe, enrich each new word), and a new study collection.
 * The old /import route redirects here with ?tab=import so its deep-links still
 * open straight on the importer; ?tab=collection opens the collection form.
 */
export default function AddPage() {
  const [tab, setTab] = useState<Tab>("single");

  // Honour ?tab=… (used by the /import → /add redirect and any deep-link).
  useEffect(() => {
    try {
      const t = new URLSearchParams(window.location.search).get("tab");
      if (t === "import") setTab("import");
      else if (t === "collection") setTab("collection");
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
      if (next === "single") url.searchParams.delete("tab");
      else url.searchParams.set("tab", next);
      window.history.replaceState(null, "", url);
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-extrabold">Add</h1>

      <div
        className="inline-flex flex-wrap p-1 rounded-xl border"
        style={{ borderColor: "var(--line)" }}
        role="tablist"
        aria-label="What to add"
      >
        <TabButton on={tab === "single"} onClick={() => select("single")}>
          ＋ Single word
        </TabButton>
        <TabButton on={tab === "import"} onClick={() => select("import")}>
          ⇪ Paste a list
        </TabButton>
        <TabButton on={tab === "collection"} onClick={() => select("collection")}>
          🗂️ New collection
        </TabButton>
      </div>

      {tab === "single" ? (
        <AddWord />
      ) : tab === "import" ? (
        <PasteImport />
      ) : (
        <NewCollection />
      )}
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
