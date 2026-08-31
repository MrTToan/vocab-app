"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Collection } from "@/lib/types";
import { jsonFetch } from "@/lib/ui";

/**
 * Manage word collections — named, curated study sets. Create / rename / delete
 * and jump straight into practising one (which scopes the picker to its words).
 * Assigning words to a collection happens from the Library and Add pages.
 */
export default function CollectionsPage() {
  const [collections, setCollections] = useState<Collection[] | null>(null);
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  async function reload() {
    const { collections } = await jsonFetch<{ collections: Collection[] }>(
      "/api/collections",
    );
    setCollections(collections);
  }
  useEffect(() => {
    reload();
  }, []);

  async function create() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await jsonFetch("/api/collections", {
        method: "POST",
        body: JSON.stringify({ name, emoji, description }),
      });
      setName("");
      setEmoji("");
      setDescription("");
      await reload();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-extrabold">Collections</h1>
        <span className="muted text-sm">{collections?.length ?? 0} collections</span>
      </div>
      <p className="muted text-sm -mt-2">
        Group words into study sets (e.g. “IELTS Task 1”). Pick a collection on
        the Practice page to drill only its words — the stage ladder is unchanged,
        so a word’s progress still counts everywhere.
      </p>

      <section className="card p-4 space-y-3">
        <div className="font-bold">New collection</div>
        <div className="flex gap-2">
          <input
            className="input w-16 text-center"
            placeholder="🎯"
            value={emoji}
            onChange={(e) => setEmoji(e.target.value)}
            aria-label="Emoji"
          />
          <input
            className="input flex-1"
            placeholder="Name (e.g. IELTS Task 1)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && create()}
          />
        </div>
        <input
          className="input"
          placeholder="Description (optional)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <button
          className="btn btn-primary"
          onClick={create}
          disabled={busy || !name.trim()}
        >
          Create
        </button>
      </section>

      {collections === null ? (
        <p className="muted">Loading…</p>
      ) : collections.length === 0 ? (
        <p className="muted">No collections yet — create one above.</p>
      ) : (
        <div className="space-y-2">
          {collections.map((c) => (
            <CollectionRow key={c.id} collection={c} onChanged={reload} />
          ))}
        </div>
      )}
    </div>
  );
}

function CollectionRow({
  collection,
  onChanged,
}: {
  collection: Collection;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(collection.name);
  const [emoji, setEmoji] = useState(collection.emoji);
  const [description, setDescription] = useState(collection.description);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await jsonFetch(`/api/collections/${collection.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name, emoji, description }),
      });
      setEditing(false);
      await onChanged();
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (
      !confirm(
        `Delete collection “${collection.name}”? The words stay; only the grouping is removed.`,
      )
    )
      return;
    setBusy(true);
    try {
      await jsonFetch(`/api/collections/${collection.id}`, { method: "DELETE" });
      await onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-4">
      {editing ? (
        <div className="space-y-2">
          <div className="flex gap-2">
            <input
              className="input w-16 text-center"
              value={emoji}
              onChange={(e) => setEmoji(e.target.value)}
              aria-label="Emoji"
            />
            <input
              className="input flex-1"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <input
            className="input"
            placeholder="Description (optional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <div className="flex gap-2">
            <button className="btn btn-primary" onClick={save} disabled={busy}>
              Save
            </button>
            <button className="btn" onClick={() => setEditing(false)} disabled={busy}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <span className="text-xl" aria-hidden>
            {collection.emoji || "📁"}
          </span>
          <div className="flex-1 min-w-0">
            <div className="font-bold truncate">{collection.name}</div>
            <div className="muted text-sm truncate">
              {collection.count ?? 0} word{(collection.count ?? 0) === 1 ? "" : "s"}
              {collection.description ? ` · ${collection.description}` : ""}
            </div>
          </div>
          <Link
            href={`/practice?collection=${collection.id}`}
            className="btn btn-primary"
          >
            Study →
          </Link>
          <button className="btn" onClick={() => setEditing(true)} disabled={busy}>
            Edit
          </button>
          <button
            className="btn"
            style={{ color: "var(--bad)", borderColor: "var(--bad)" }}
            onClick={remove}
            disabled={busy}
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}
