"use client";

import { useState } from "react";
import { jsonFetch } from "@/lib/ui";
import { revalidateCollections } from "@/lib/swr";

/**
 * The "New collection" create form — emoji + name + description + Create. It
 * lives on the Add tab (moved out of Home's Collections section); after a
 * successful create it revalidates the shared /api/collections SWR key so the
 * new set shows up in Home's list without a manual reload.
 *
 * The icon field is a tap-to-pick palette rather than a type-an-emoji input:
 * on a phone a bare text input for an emoji is just a blur target, so we give a
 * grid of sensible collection icons and highlight the chosen one.
 */

// A small, deliberate set — enough to label most study sets, few enough to tap.
const ICONS = [
  "📚", "📈", "📝", "💬", "🎓", "🎯",
  "⭐", "🔖", "🗂️", "🧠", "🌍", "🔤",
];

export default function NewCollection({ onCreated }: { onCreated?: () => void }) {
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState(ICONS[0]);
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  async function create() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await jsonFetch("/api/collections", {
        method: "POST",
        body: JSON.stringify({ name, emoji, description }),
      });
      setName("");
      setEmoji(ICONS[0]);
      setDescription("");
      await revalidateCollections();
      onCreated?.();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <p className="muted text-sm">
        Group words into a named study set (e.g. “IELTS Task 1”). Pick it on the
        Practice page to drill only its words. New collections appear under
        Collections on the Home tab.
      </p>

      <section className="card p-4 space-y-4">
        <div>
          <label className="block text-sm font-bold mb-2">Icon</label>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Collection icon">
            {ICONS.map((ic) => {
              const selected = ic === emoji;
              return (
                <button
                  key={ic}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={`Icon ${ic}`}
                  onClick={() => setEmoji(ic)}
                  className="w-11 h-11 rounded-xl text-xl flex items-center justify-center border transition-colors"
                  style={
                    selected
                      ? {
                          borderColor: "var(--accent)",
                          background: "var(--accent-soft)",
                          boxShadow: "0 0 0 2px var(--accent-soft)",
                        }
                      : { borderColor: "var(--line)" }
                  }
                >
                  {ic}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <label className="block text-sm font-bold mb-2">Name</label>
          <input
            className="input"
            placeholder="e.g. IELTS Task 1"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && create()}
          />
        </div>

        <div>
          <label className="block text-sm font-bold mb-2">
            Description <span className="muted font-normal">(optional)</span>
          </label>
          <input
            className="input"
            placeholder="What's this set for?"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        <button
          className="btn btn-primary"
          onClick={create}
          disabled={busy || !name.trim()}
        >
          Create collection
        </button>
      </section>
    </div>
  );
}
