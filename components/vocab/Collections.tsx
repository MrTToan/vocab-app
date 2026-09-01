"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { Collection } from "@/lib/types";
import { jsonFetch } from "@/lib/ui";
import {
  useCollections,
  revalidateCollections,
  revalidateWords,
  revalidateStats,
} from "@/lib/swr";

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
  // Shared SWR cache — the same /api/collections fetch the Library and Add pages
  // use, so it's deduped and every collection write here is reflected there.
  const { data } = useCollections();
  const collections = data?.collections ?? null;
  const owner = !!data?.owner;

  const reload = revalidateCollections;

  const mine = (collections ?? []).filter((c) => c.mine);
  const shared = (collections ?? []).filter((c) => !c.mine);

  return (
    <div className="space-y-5">
      <p className="muted text-sm">
        Group words into study sets (e.g. “IELTS Task 1”). Pick a collection on
        the Practice page to drill only its words — the stage ladder is unchanged,
        so a word’s progress still counts everywhere. Create a new one from the{" "}
        <Link href="/add?tab=collection" className="underline font-semibold">
          Add tab
        </Link>
        .
      </p>

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
            <p className="muted">
              No collections yet —{" "}
              <Link href="/add?tab=collection" className="underline font-semibold">
                create one on the Add tab
              </Link>
              .
            </p>
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
      // Adopting inserts user_words rows, so the Library list and stats change.
      await Promise.all([revalidateWords(), revalidateStats()]);
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
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <span className="text-xl shrink-0" aria-hidden>
              {collection.emoji || "📁"}
            </span>
            <div className="flex-1 min-w-0">
              {/* name must truncate on a plain span (not a flex parent), and the
                  Public chip must not shrink — otherwise the name collapses (#8). */}
              <div className="flex items-center gap-2">
                <span className="font-bold truncate">{collection.name}</span>
                {isPublic && (
                  <span
                    className="chip text-xs shrink-0"
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
          </div>
          {/* Actions: wrap under the name on phones, stay inline on the right on
              desktop; each button is shrink-0 so it keeps its size. */}
          <div className="flex flex-wrap items-center gap-2 sm:ml-auto sm:shrink-0">
            <Link
              href={`/practice?collection=${collection.id}`}
              className="btn btn-primary shrink-0"
            >
              Study →
            </Link>
            {!collection.mine && (
              <button className="btn shrink-0" onClick={adopt} disabled={busy}>
                Add all
              </button>
            )}
            {collection.mine && owner && (
              <button className="btn shrink-0" onClick={toggleVisibility} disabled={busy}>
                {isPublic ? "Make private" : "Make public"}
              </button>
            )}
            {collection.mine && (
              <>
                <button className="btn shrink-0" onClick={() => setEditing(true)} disabled={busy}>
                  Edit
                </button>
                <button
                  className="btn shrink-0"
                  style={{ color: "var(--bad)", borderColor: "var(--bad)" }}
                  onClick={remove}
                  disabled={busy}
                >
                  Delete
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
