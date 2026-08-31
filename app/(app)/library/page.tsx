"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Collection, Stage, Word } from "@/lib/types";
import {
  STAGE_ORDER,
  STAGE_LABEL,
  STAGE_VAR,
  recentAccuracy,
  isWeak,
  jsonFetch,
} from "@/lib/ui";

type Filter = "all" | "weak" | Stage;
type Membership = { word_id: string; collection_id: string };
const EMPTY_SET: ReadonlySet<string> = new Set();

export default function LibraryPage() {
  const [words, setWords] = useState<Word[] | null>(null);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [collectionFilter, setCollectionFilter] = useState<string>(""); // "" = any

  async function reload() {
    const [w, c] = await Promise.all([
      jsonFetch<{ words: Word[] }>("/api/words"),
      jsonFetch<{ collections: Collection[]; memberships: Membership[] }>(
        "/api/collections",
      ),
    ]);
    setWords(w.words);
    setCollections(c.collections);
    setMemberships(c.memberships);
  }
  useEffect(() => {
    reload();
  }, []);

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

  const shown = useMemo(() => {
    if (!words) return [];
    const needle = q.trim().toLowerCase();
    return words.filter((w) => {
      if (filter === "weak" && !isWeak(w)) return false;
      if (filter !== "all" && filter !== "weak" && w.stage !== filter)
        return false;
      if (collectionFilter && !memberMap.get(w.id)?.has(collectionFilter))
        return false;
      if (!needle) return true;
      return (
        w.word.toLowerCase().includes(needle) ||
        w.vi_meaning.toLowerCase().includes(needle) ||
        w.tags.some((t) => t.toLowerCase().includes(needle))
      );
    });
  }, [words, q, filter, collectionFilter, memberMap]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-extrabold">Library</h1>
        <span className="muted text-sm">{words?.length ?? 0} words</span>
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
          <Link href="/collections" className="muted text-xs underline whitespace-nowrap">
            manage
          </Link>
        </div>
      )}

      {words === null ? (
        <p className="muted">Loading…</p>
      ) : shown.length === 0 ? (
        <p className="muted">No words match.</p>
      ) : (
        <div className="space-y-2">
          {shown.map((w) => (
            <Row
              key={w.id}
              word={w}
              collections={collections}
              memberIds={memberMap.get(w.id) ?? EMPTY_SET}
              onChanged={reload}
            />
          ))}
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
  word,
  collections,
  memberIds,
  onChanged,
}: {
  word: Word;
  collections: Collection[];
  memberIds: ReadonlySet<string>;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState<Word>(word);
  const [busy, setBusy] = useState(false);
  const acc = recentAccuracy(word);

  async function toggleCollection(collectionId: string, on: boolean) {
    setBusy(true);
    try {
      await jsonFetch(`/api/collections/${collectionId}/members`, {
        method: "POST",
        body: JSON.stringify(on ? { add: [word.id] } : { remove: [word.id] }),
      });
      await onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    try {
      await jsonFetch(`/api/words/${word.id}`, {
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
      });
      await onChanged();
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!confirm(`Delete “${word.word}”?`)) return;
    setBusy(true);
    try {
      await jsonFetch(`/api/words/${word.id}`, { method: "DELETE" });
      await onChanged();
    } finally {
      setBusy(false);
    }
  }
  async function resetProgress() {
    setBusy(true);
    try {
      await jsonFetch(`/api/words/${word.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          stage: "new",
          times_seen: 0,
          recent_results: [],
          last_seen_at: null,
        }),
      });
      await onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card overflow-hidden">
      <button
        className="w-full text-left p-4 flex items-center gap-3"
        onClick={() => setOpen(!open)}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-bold truncate">{word.word}</span>
            {word.ipa && (
              <span className="muted text-xs truncate">{word.ipa}</span>
            )}
          </div>
          <div className="muted text-sm truncate">
            {word.vi_meaning || "— no meaning yet —"}
          </div>
        </div>
        <span
          className="chip"
          style={{
            background: "transparent",
            color: STAGE_VAR[word.stage],
            borderColor: STAGE_VAR[word.stage],
          }}
        >
          {STAGE_LABEL[word.stage]}
        </span>
        {word.times_seen > 0 && (
          <span className="muted text-xs w-10 text-right">
            {Math.round(acc * 100)}%
          </span>
        )}
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3 border-t pt-3" style={{ borderColor: "var(--line)" }}>
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
                <a href="/collections" className="underline">create one</a>.
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5 mt-1">
                {collections.map((c) => {
                  const on = memberIds.has(c.id);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      disabled={busy}
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
