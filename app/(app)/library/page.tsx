"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { mutate } from "swr";
import type { Collection, Stage, Word, WordListItem } from "@/lib/types";
import {
  STAGE_ORDER,
  STAGE_LABEL,
  STAGE_VAR,
  recentAccuracy,
  jsonFetch,
} from "@/lib/ui";
import {
  useWordsPage,
  useCollections,
  useWord,
  wordKey,
  WORDS_PAGE_SIZE,
  applyMembershipToCache,
  applyWordAdoptedToCache,
  mutateAfterWordChange,
  revalidateStats,
} from "@/lib/swr";

type Filter = "all" | "weak" | Stage;
const EMPTY_SET: ReadonlySet<string> = new Set();

export default function LibraryPage() {
  const { data: colData } = useCollections();
  const collections = colData?.collections ?? [];
  const memberships = colData?.memberships ?? [];

  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [collectionFilter, setCollectionFilter] = useState<string>(""); // "" = any

  // Debounce the search box so each keystroke doesn't fire a server request.
  const [debouncedQ, setDebouncedQ] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 250);
    return () => clearTimeout(t);
  }, [q]);

  // Server-side paginated + filtered list: search / stage / collection all
  // compose in SQL and page together (a collection shows ALL its members —
  // studied and not-yet-studied — so the count and the list agree). Each
  // "Show more" loads one more page from the server, never the whole list.
  const { data, size, setSize, isValidating } = useWordsPage({
    q: debouncedQ,
    stage: filter,
    collection: collectionFilter,
  });
  const pages = data ?? null;
  const words = useMemo(
    () => (pages ? pages.flatMap((p) => p.words) : null),
    [pages],
  );
  const total = pages?.[0]?.total ?? 0;
  const hasMore = words != null && words.length < total;
  const loadingMore = isValidating && (pages?.length ?? 0) < size;

  // A filter change makes the previous pages irrelevant — collapse back to one
  // page so we don't refetch several pages of the new filter at once.
  useEffect(() => {
    setSize(1);
  }, [debouncedQ, filter, collectionFilter, setSize]);

  // Optimistic, in-place membership toggle in the SWR cache — no full reload,
  // no refetch (composes with the instant chip toggle from PR #11).
  function applyMembership(wordId: string, collectionId: string, on: boolean) {
    applyMembershipToCache(wordId, collectionId, on);
  }

  // Start studying a not-yet-studied collection member. Optimistic: flip the
  // row's flag immediately, persist in the background, revert on failure.
  async function adoptWord(wordId: string) {
    applyWordAdoptedToCache(wordId);
    revalidateStats();
    try {
      await jsonFetch(`/api/words/${wordId}/adopt`, { method: "POST" });
    } catch {
      // The word stays visible (it's a collection member); refetch the truth.
      await mutateAfterWordChange();
    }
  }

  // word id -> set of its collection ids (from the flat membership list)
  const memberMap = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const { word_id, collection_id } of memberships) {
      (m.get(word_id) ?? m.set(word_id, new Set()).get(word_id)!).add(
        collection_id,
      );
    }
    return m;
  }, [memberships]);

  const selectedCollection = collections.find((c) => c.id === collectionFilter);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-extrabold">Library</h1>
        <span className="muted text-sm">{total} words</span>
      </div>

      <input
        className="input"
        placeholder="Search word, meaning, tag…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />

      <div className="flex flex-wrap gap-1.5">
        <Pill active={filter === "all"} onClick={() => setFilter("all")}>
          All
        </Pill>
        <Pill active={filter === "weak"} onClick={() => setFilter("weak")}>
          Weak
        </Pill>
        {STAGE_ORDER.map((s) => (
          <Pill key={s} active={filter === s} onClick={() => setFilter(s)}>
            {STAGE_LABEL[s]}
          </Pill>
        ))}
      </div>

      {collections.length > 0 && (
        <div className="flex items-center gap-2 text-sm">
          <span className="muted">Collection</span>
          <select
            className="input py-1.5 flex-1 min-w-0"
            value={collectionFilter}
            onChange={(e) => setCollectionFilter(e.target.value)}
            aria-label="Filter by collection"
          >
            <option value="">Any</option>
            {collections.map((c) => (
              <option key={c.id} value={c.id}>
                {(c.emoji ? `${c.emoji} ` : "") + c.name} ({c.count ?? 0})
              </option>
            ))}
          </select>
          <Link href="/vocab#collections" className="muted text-xs underline whitespace-nowrap">
            manage
          </Link>
        </div>
      )}

      {selectedCollection && (
        <p className="muted text-xs">
          Showing all words in{" "}
          <span className="font-semibold">{selectedCollection.name}</span> —
          words you don’t study yet have an{" "}
          <span className="font-semibold">Add</span> button.
        </p>
      )}

      {words === null ? (
        <p className="muted">Loading…</p>
      ) : words.length === 0 ? (
        <p className="muted">No words match.</p>
      ) : (
        <div className="space-y-2">
          {words.map((w) => (
            <Row
              key={w.id}
              item={w}
              collections={collections}
              memberIds={memberMap.get(w.id) ?? EMPTY_SET}
              onToggleMembership={applyMembership}
              onAdopt={adoptWord}
            />
          ))}
          {hasMore && (
            <button
              className="btn w-full"
              onClick={() => setSize(size + 1)}
              disabled={loadingMore}
            >
              {loadingMore
                ? "Loading…"
                : `Show more (${total - words.length} more)`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Pill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="px-3 py-1 rounded-full text-sm font-semibold border transition-colors"
      style={
        active
          ? {
              background: "var(--accent)",
              borderColor: "var(--accent)",
              color: "#fff",
            }
          : { borderColor: "var(--line)", color: "var(--muted)" }
      }
    >
      {children}
    </button>
  );
}

function Row({
  item,
  collections,
  memberIds,
  onToggleMembership,
  onAdopt,
}: {
  item: WordListItem;
  collections: Collection[];
  memberIds: ReadonlySet<string>;
  onToggleMembership: (wordId: string, collectionId: string, on: boolean) => void;
  onAdopt: (wordId: string) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [adopting, setAdopting] = useState(false);
  // Full word (definition/examples/notes) is loaded on demand only when the row
  // is expanded — the list itself carries just the slim fields. SWR caches it, so
  // reopening is instant.
  const { data: fullData } = useWord(open ? item.id : null);
  const full = fullData?.word;
  const [edit, setEdit] = useState<Word | null>(null);
  const [busy, setBusy] = useState(false);
  const [membershipError, setMembershipError] = useState<string | null>(null);
  // Per-collection in-flight guard so rapid taps on the same chip don't race.
  const [pending, setPending] = useState<ReadonlySet<string>>(EMPTY_SET);
  const acc = recentAccuracy(item);

  // Seed the editor once the full word arrives.
  useEffect(() => {
    if (full) setEdit(full);
  }, [full]);

  async function toggleCollection(collectionId: string, on: boolean) {
    if (pending.has(collectionId)) return;
    setMembershipError(null);
    // 1. Optimistic: flip the chip immediately (in the SWR cache, no refetch).
    onToggleMembership(item.id, collectionId, on);
    setPending((prev) => new Set(prev).add(collectionId));
    // 2. Persist in the background — no full reload.
    try {
      await jsonFetch(`/api/collections/${collectionId}/members`, {
        method: "POST",
        body: JSON.stringify(on ? { add: [item.id] } : { remove: [item.id] }),
      });
    } catch {
      // 3. Revert on failure.
      onToggleMembership(item.id, collectionId, !on);
      setMembershipError("Couldn't update collection. Try again.");
    } finally {
      setPending((prev) => {
        const next = new Set(prev);
        next.delete(collectionId);
        return next;
      });
    }
  }

  async function save() {
    if (!edit) return;
    setBusy(true);
    try {
      const { word: updated } = await jsonFetch<{ word: Word }>(
        `/api/words/${item.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            vi_meaning: edit.vi_meaning,
            definition_en: edit.definition_en,
            example_simple: edit.example_simple,
            example_complex: edit.example_complex,
            false_friend_note: edit.false_friend_note,
            personal_note: edit.personal_note,
            synonyms: edit.synonyms,
            collocations: edit.collocations,
            tags: edit.tags,
          }),
        },
      );
      // Prime the per-word cache with the fresh detail, then refresh the list/stats.
      mutate(wordKey(item.id), { word: updated }, { revalidate: false });
      await mutateAfterWordChange();
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!confirm(`Delete “${item.word}”?`)) return;
    setBusy(true);
    try {
      await jsonFetch(`/api/words/${item.id}`, { method: "DELETE" });
      mutate(wordKey(item.id), undefined, { revalidate: false });
      await mutateAfterWordChange();
    } finally {
      setBusy(false);
    }
  }
  async function resetProgress() {
    setBusy(true);
    try {
      const { word: updated } = await jsonFetch<{ word: Word }>(
        `/api/words/${item.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            stage: "new",
            times_seen: 0,
            recent_results: [],
            last_seen_at: null,
          }),
        },
      );
      mutate(wordKey(item.id), { word: updated }, { revalidate: false });
      await mutateAfterWordChange();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card overflow-hidden">
      {/* Header is a flex row (not one big <button>) so the studying "+ Add"
          control can be a real sibling <button> — nesting a button inside a
          button is invalid HTML. The word/meaning area is the expand trigger. */}
      <div className="p-4 flex items-center gap-3">
        <button
          className="flex-1 min-w-0 text-left flex items-center gap-3"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
        >
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-bold truncate">{item.word}</span>
              {item.ipa && (
                <span className="muted text-xs truncate">{item.ipa}</span>
              )}
            </div>
            <div className="muted text-sm truncate">
              {item.vi_meaning || "— no meaning yet —"}
            </div>
          </div>
          <span
            className="chip"
            style={{
              background: "transparent",
              color: STAGE_VAR[item.stage],
              borderColor: STAGE_VAR[item.stage],
            }}
          >
            {STAGE_LABEL[item.stage]}
          </span>
          {item.studying && item.times_seen > 0 && (
            <span className="muted text-xs w-10 text-right">
              {Math.round(acc * 100)}%
            </span>
          )}
        </button>
        {!item.studying && (
          // A collection member the user does not study yet — offer to add it.
          <button
            type="button"
            aria-label={`Add ${item.word} to my studying`}
            disabled={adopting}
            onClick={() => {
              setAdopting(true);
              Promise.resolve(onAdopt(item.id)).finally(() =>
                setAdopting(false),
              );
            }}
            className="px-2.5 py-1 rounded-full text-sm font-semibold border transition-colors whitespace-nowrap"
            style={{
              background: "var(--accent)",
              borderColor: "var(--accent)",
              color: "#fff",
              opacity: adopting ? 0.6 : 1,
            }}
          >
            {adopting ? "Adding…" : "+ Add"}
          </button>
        )}
      </div>

      {open && (
        <div className="px-4 pb-4 space-y-3 border-t pt-3" style={{ borderColor: "var(--line)" }}>
          {!edit ? (
            <p className="muted text-sm">Loading…</p>
          ) : (
            <>
              <E label="Vietnamese meaning" v={edit.vi_meaning} set={(x) => setEdit({ ...edit, vi_meaning: x })} />
              <E label="English definition" v={edit.definition_en} set={(x) => setEdit({ ...edit, definition_en: x })} />
              <E label="Example (simple)" v={edit.example_simple} set={(x) => setEdit({ ...edit, example_simple: x })} area />
              <E label="Example (complex)" v={edit.example_complex} set={(x) => setEdit({ ...edit, example_complex: x })} area />
              <E label="Synonyms" v={edit.synonyms.join(", ")} set={(x) => setEdit({ ...edit, synonyms: splitList(x) })} />
              <E label="Collocations" v={edit.collocations.join(", ")} set={(x) => setEdit({ ...edit, collocations: splitList(x) })} />
              <E label="Usage trap" v={edit.false_friend_note} set={(x) => setEdit({ ...edit, false_friend_note: x })} />
              <E label="Your note" v={edit.personal_note} set={(x) => setEdit({ ...edit, personal_note: x })} />
              <E label="Tags" v={edit.tags.join(", ")} set={(x) => setEdit({ ...edit, tags: splitList(x) })} />

              <div>
                <span className="text-xs font-semibold muted">Collections</span>
                {collections.length === 0 ? (
                  <p className="muted text-sm mt-1">
                    No collections yet —{" "}
                    <a href="/vocab#collections" className="underline">create one</a>.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {collections.map((c) => {
                      const on = memberIds.has(c.id);
                      return (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => toggleCollection(c.id, !on)}
                          className="px-2.5 py-1 rounded-full text-sm font-semibold border transition-colors"
                          style={
                            on
                              ? { background: "var(--accent)", borderColor: "var(--accent)", color: "#fff" }
                              : { borderColor: "var(--line)", color: "var(--muted)" }
                          }
                          title={on ? "Click to remove" : "Click to add"}
                        >
                          {(c.emoji ? `${c.emoji} ` : "") + c.name}
                        </button>
                      );
                    })}
                  </div>
                )}
                {membershipError && (
                  <p className="text-sm mt-1" style={{ color: "var(--bad)" }}>
                    {membershipError}
                  </p>
                )}
              </div>

              <div className="flex flex-wrap gap-2 pt-1">
                <button className="btn btn-primary" onClick={save} disabled={busy}>
                  Save
                </button>
                <button className="btn" onClick={resetProgress} disabled={busy}>
                  Reset progress
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
            </>
          )}
        </div>
      )}
    </div>
  );
}

function splitList(s: string): string[] {
  return s.split(",").map((x) => x.trim()).filter(Boolean);
}

function E({
  label,
  v,
  set,
  area,
}: {
  label: string;
  v: string;
  set: (x: string) => void;
  area?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-xs font-semibold muted">{label}</span>
      {area ? (
        <textarea
          className="input mt-1 min-h-[3rem] resize-y"
          value={v}
          onChange={(e) => set(e.target.value)}
        />
      ) : (
        <input className="input mt-1" value={v} onChange={(e) => set(e.target.value)} />
      )}
    </label>
  );
}
