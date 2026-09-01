"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { Collection } from "@/lib/types";
import { jsonFetch } from "@/lib/ui";

/**
 * Manage word collections — named, curated study sets. Create / rename / delete
 * and jump straight into practising one (which scopes the picker to its words).
 * The list also shows PUBLIC collections shared by everyone; you can "add all" a
 * public pack to your own study rotation. Assigning individual words to a
 * collection happens from the Library and Add pages.
 *
 * This is the collections manager that used to live at its own /collections
 * route; it now renders inside the Home page. `highlightId` scrolls to and
 * highlights one collection so the old /collections?collection=<id> deep-link
 * keeps working after the redirect.
 */
export default function Collections({ highlightId }: { highlightId?: string }) {
  const [collections, setCollections] = useState<Collection[] | null>(null);
  const [owner, setOwner] = useState(false);
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  async function reload() {
    const { collections, owner } = await jsonFetch<{
      collections: Collection[];
      owner: boolean;
    }>("/api/collections");
    setCollections(collections);
    setOwner(!!owner);
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

  const mine = (collections ?? []).filter((c) => c.mine);
  const shared = (collections ?? []).filter((c) => !c.mine);

  return (
    <div className="space-y-5">
      <p className="muted text-sm">
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
      ) : (
        <>
          {mine.length > 0 && (
            <div className="space-y-2">
              {mine.map((c) => (
                <CollectionRow
                  key={c.id}
                  collection={c}
                  owner={owner}
                  onChanged={reload}
                  highlight={c.id === highlightId}
                />
              ))}
            </div>
          )}
          {shared.length > 0 && (
            <>
              <h3 className="text-sm font-bold muted mt-4">Public collections</h3>
              <div className="space-y-2">
                {shared.map((c) => (
                  <CollectionRow
                    key={c.id}
                    collection={c}
                    owner={owner}
                    onChanged={reload}
                    highlight={c.id === highlightId}
                  />
                ))}
              </div>
            </>
          )}
          {collections.length === 0 && (
            <p className="muted">No collections yet — create one above.</p>
          )}
        </>
      )}
    </div>
  );
}

function CollectionRow({
  collection,
  owner,
  onChanged,
  highlight,
}: {
  collection: Collection;
  owner: boolean;
  onChanged: () => void;
  highlight?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(collection.name);
  const [emoji, setEmoji] = useState(collection.emoji);
  const [description, setDescription] = useState(collection.description);
  const [busy, setBusy] = useState(false);
  const isPublic = collection.visibility === "public";
  const rowRef = useRef<HTMLDivElement>(null);

  // Deep-link target (from the old /collections?collection=<id> URL): scroll it
  // into view once so the redirected link still lands on the right collection.
  useEffect(() => {
    if (highlight) {
      rowRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [highlight]);

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
  async function toggleVisibility() {
    setBusy(true);
    try {
      await jsonFetch(`/api/collections/${collection.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          visibility: isPublic ? "private" : "public",
        }),
      });
      await onChanged();
    } finally {
      setBusy(false);
    }
  }
  async function adopt() {
    setBusy(true);
    try {
      const { adopted } = await jsonFetch<{ adopted: number }>(
        `/api/collections/${collection.id}/adopt`,
        { method: "POST" },
      );
      alert(`Added ${adopted} word${adopted === 1 ? "" : "s"} to your rotation.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      ref={rowRef}
      className="card p-4"
      style={
        highlight
          ? { borderColor: "var(--accent)", boxShadow: "0 0 0 3px var(--accent-soft)" }
          : undefined
      }
    >
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
            <div className="font-bold truncate flex items-center gap-2">
              {collection.name}
              {isPublic && (
                <span
                  className="chip text-xs"
                  style={{ color: "var(--accent)", borderColor: "var(--accent)" }}
                >
                  Public
                </span>
              )}
            </div>
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
          {!collection.mine && (
            <button className="btn" onClick={adopt} disabled={busy}>
              Add all
            </button>
          )}
          {collection.mine && owner && (
            <button className="btn" onClick={toggleVisibility} disabled={busy}>
              {isPublic ? "Make private" : "Make public"}
            </button>
          )}
          {collection.mine && (
            <>
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
            </>
          )}
        </div>
      )}
    </div>
  );
}
