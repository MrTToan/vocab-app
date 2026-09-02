"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { jsonFetch } from "@/lib/ui";
import {
  mutateAfterWordChange,
  revalidateCollections,
  useCollections,
} from "@/lib/swr";
import { parsePasteList, MAX_PASTE_WORDS } from "@/lib/paste";
import ImportWords from "@/components/vocab/ImportWords";

type Phase = "input" | "preview" | "running" | "done";

/** Where to file the pasted list: nowhere, an existing collection, or a new one. */
type ColMode = "none" | "existing" | "new";

interface Plan {
  newWords: string[]; // brand-new words to enrich + add
  taggedExisting: { word: string; matched: string; id: string }[]; // link, don't dupe
  duplicatesInPaste: number; // lemma repeats within the paste
  capped: boolean; // more new words than MAX_PASTE_WORDS
}

interface RunResult {
  added: { word: string; corrected?: string }[];
  taggedCount: number; // existing words linked into the collection
  duplicatesMerged: number; // lemma repeats within the paste
  failed: { word: string; error: string }[];
  collectionName: string | null; // where things were filed (null = no collection)
  quotaHit: boolean;
  quotaMessage?: string;
}

const CHUNK = 4; // words per request — keeps progress lively and requests short

/**
 * Paste-a-word-list importer: the primary "Import" flow. The user pastes a list
 * of English words and optionally files the whole list into a collection —
 * picking an existing one or creating a new (private) one inline. We parse +
 * dedupe by LEMMA (base form) both within the paste and against the user's
 * library BEFORE spending any LLM quota, so words that already exist are TAGGED
 * into the collection rather than duplicated, and only brand-new words are
 * enriched + added through the same pipeline single-word Add uses. The old CSV
 * importer lives on as a collapsed "Advanced" option.
 */
export default function PasteImport() {
  const [hasLLM, setHasLLM] = useState(true);
  const [text, setText] = useState("");
  const [phase, setPhase] = useState<Phase>("input");
  const [checking, setChecking] = useState(false);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [result, setResult] = useState<RunResult | null>(null);
  const [error, setError] = useState("");
  const cancelled = useRef(false);

  // Collection target. Only the caller's own (editable) collections can be
  // tagged into, so the dropdown lists `mine`.
  const { data: colData } = useCollections();
  const myCollections = useMemo(
    () => (colData?.collections ?? []).filter((c) => c.mine),
    [colData],
  );
  const [colMode, setColMode] = useState<ColMode>("none");
  const [colId, setColId] = useState("");
  const [newColName, setNewColName] = useState("");
  // Effective selection: the user's pick, else the first of their collections.
  // Derived (not stored) so it needs no defaulting effect.
  const selectedColId = colId || (myCollections[0]?.id ?? "");

  useEffect(() => {
    jsonFetch<{ hasLLM: boolean }>("/api/config")
      .then((c) => setHasLLM(c.hasLLM))
      .catch(() => {});
  }, []);

  // Live count as the user pastes — cheap, no network.
  const parsed = useMemo(() => parsePasteList(text), [text]);

  const willTag = colMode !== "none";

  function reset() {
    setText("");
    setPhase("input");
    setPlan(null);
    setResult(null);
    setError("");
    setProgress({ done: 0, total: 0 });
  }

  async function check() {
    setError("");
    const { words } = parsed;
    if (words.length === 0) return;
    setChecking(true);
    try {
      const p = await jsonFetch<Plan>("/api/words/import-plan", {
        method: "POST",
        body: JSON.stringify({ words }),
      });
      setPlan(p);
      setPhase("preview");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setChecking(false);
    }
  }

  /** Resolve the chosen target to a collection id, creating it if "new". */
  async function resolveCollection(): Promise<{ id: string; name: string } | null> {
    if (colMode === "existing" && selectedColId) {
      const c = myCollections.find((x) => x.id === selectedColId);
      return c ? { id: c.id, name: c.name } : null;
    }
    if (colMode === "new") {
      const name = newColName.trim();
      if (!name) return null;
      const { collection } = await jsonFetch<{ collection: { id: string; name: string } }>(
        "/api/collections",
        { method: "POST", body: JSON.stringify({ name }) },
      );
      await revalidateCollections();
      return { id: collection.id, name: collection.name };
    }
    return null;
  }

  async function run() {
    if (!plan) return;
    setError("");

    // 1) Resolve/create the collection (if any).
    let target: { id: string; name: string } | null = null;
    try {
      target = await resolveCollection();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    if (colMode === "new" && !target) {
      setError("Please name the new collection.");
      return;
    }

    const queue = plan.newWords.slice(0, MAX_PASTE_WORDS);
    cancelled.current = false;
    setPhase("running");
    setProgress({ done: 0, total: queue.length });

    let taggedCount = 0;
    const acc: RunResult = {
      added: [],
      taggedCount: 0,
      duplicatesMerged: plan.duplicatesInPaste,
      failed: [],
      collectionName: target?.name ?? null,
      quotaHit: false,
    };

    try {
      // 2) Tag every already-existing word into the collection (no LLM). Reuses
      //    the shared membership primitive; the route re-validates each id.
      if (target && plan.taggedExisting.length) {
        await jsonFetch(`/api/collections/${target.id}/members`, {
          method: "POST",
          body: JSON.stringify({ add: plan.taggedExisting.map((t) => t.id) }),
        });
        taggedCount += plan.taggedExisting.length;
      }

      // 3) Enrich + add the brand-new words in chunks, tagging each into the
      //    collection server-side.
      for (let i = 0; i < queue.length; i += CHUNK) {
        if (cancelled.current) break;
        const chunk = queue.slice(i, i + CHUNK);
        const res = await jsonFetch<{
          added: { word: string; corrected?: string }[];
          tagged: { word: string; matched: string }[];
          skipped: string[];
          failed: { word: string; error: string }[];
          quotaExhausted: boolean;
          quotaMessage?: string;
        }>("/api/words/import-paste", {
          method: "POST",
          body: JSON.stringify({
            words: chunk,
            ...(target ? { collectionId: target.id } : {}),
          }),
        });
        acc.added.push(...res.added);
        acc.failed.push(...res.failed);
        if (target) taggedCount += res.tagged.length; // late-detected existing
        setProgress({ done: Math.min(i + chunk.length, queue.length), total: queue.length });
        if (res.quotaExhausted) {
          acc.quotaHit = true;
          acc.quotaMessage = res.quotaMessage;
          break; // stop cleanly — daily limit reached
        }
      }
      acc.taggedCount = taggedCount;
      setResult(acc);
      setPhase("done");
    } catch (e) {
      acc.taggedCount = taggedCount;
      setResult(acc);
      setError(e instanceof Error ? e.message : String(e));
      setPhase("done");
    } finally {
      // Words/memberships may have changed even on a partial failure — refresh
      // the Library list, stats and collection counts.
      if (acc.added.length || taggedCount) {
        void mutateAfterWordChange();
        void revalidateCollections();
      }
    }
  }

  // Preview headline numbers.
  const newCount = plan ? Math.min(plan.newWords.length, MAX_PASTE_WORDS) : 0;

  return (
    <div className="space-y-5">
      {/* ── Input ── */}
      {phase === "input" && (
        <div className="card p-5 space-y-3">
          <div>
            <div className="font-bold">Paste your words</div>
            <p className="muted text-sm mt-0.5">
              One per line or separated by commas. Lexi looks up the meaning,
              examples and synonyms for each — you don&apos;t fill anything in.
            </p>
          </div>
          <textarea
            className="input min-h-[10rem] text-base leading-relaxed"
            placeholder={"reluctant\nmeticulous\nget away with\nubiquitous, ephemeral, candid"}
            value={text}
            onChange={(e) => setText(e.target.value)}
            autoFocus
          />

          {/* Collection target */}
          <CollectionTarget
            mode={colMode}
            setMode={setColMode}
            colId={selectedColId}
            setColId={setColId}
            newColName={newColName}
            setNewColName={setNewColName}
            collections={myCollections}
          />

          <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:justify-between">
            <span className="muted text-sm">
              {parsed.words.length > 0
                ? `${parsed.words.length} word${parsed.words.length === 1 ? "" : "s"} detected`
                : "Nothing pasted yet"}
              {parsed.duplicatesInPaste > 0 &&
                ` · ${parsed.duplicatesInPaste} exact repeat${parsed.duplicatesInPaste === 1 ? "" : "s"} in your paste ignored`}
            </span>
            <button
              className="btn btn-primary w-full sm:w-auto"
              onClick={check}
              disabled={parsed.words.length === 0 || checking}
            >
              {checking ? "Checking…" : "Check list →"}
            </button>
          </div>
          {!hasLLM && (
            <p className="text-sm" style={{ color: "var(--warn)" }}>
              No API key is set, so Lexi can&apos;t look words up automatically. Add
              a key, or use the single-word Add tab to fill words in by hand.
            </p>
          )}
        </div>
      )}

      {/* ── Preview / cost gate ── */}
      {phase === "preview" && plan && (
        <div className="card p-5 space-y-4">
          <div>
            <div className="font-bold text-lg">Ready to import</div>
            <p className="text-sm mt-1">
              <b style={{ color: "var(--good)" }}>
                {plan.newWords.length} new word
                {plan.newWords.length === 1 ? "" : "s"}
              </b>
              {plan.taggedExisting.length > 0 && (
                <>
                  {" · "}
                  <span className="muted">
                    {plan.taggedExisting.length} already in your list
                    {willTag ? " (will be tagged, not duplicated)" : " (skipped)"}
                  </span>
                </>
              )}
              {plan.duplicatesInPaste > 0 && (
                <>
                  {" · "}
                  <span className="muted">
                    {plan.duplicatesInPaste} duplicate
                    {plan.duplicatesInPaste === 1 ? "" : "s"} merged
                  </span>
                </>
              )}
            </p>
            {willTag && (
              <p className="muted text-xs mt-1">
                Filing into{" "}
                <b>
                  {colMode === "new"
                    ? newColName.trim() || "your new collection"
                    : myCollections.find((c) => c.id === selectedColId)?.name ?? "collection"}
                </b>
                .
              </p>
            )}
          </div>

          {plan.capped && (
            <div
              className="text-sm rounded-lg p-3"
              style={{ background: "var(--warn-soft)", border: "1px solid var(--warn)" }}
            >
              That&apos;s a big list. To protect your daily limit, only the first{" "}
              <b>{MAX_PASTE_WORDS}</b> new words will be imported this run — paste
              the rest afterwards.
            </div>
          )}

          {plan.newWords.length > 0 && (
            <div className="text-sm">
              <div className="flex flex-wrap gap-1.5 max-h-32 overflow-auto">
                {plan.newWords.slice(0, MAX_PASTE_WORDS).slice(0, 40).map((w, i) => (
                  <span
                    key={i}
                    className="px-2 py-0.5 rounded-full"
                    style={{ background: "var(--accent-soft, rgba(0,0,0,0.05))" }}
                  >
                    {w}
                  </span>
                ))}
                {Math.min(plan.newWords.length, MAX_PASTE_WORDS) > 40 && (
                  <span className="muted px-1 py-0.5">
                    +{Math.min(plan.newWords.length, MAX_PASTE_WORDS) - 40} more
                  </span>
                )}
              </div>
            </div>
          )}

          {plan.newWords.length === 0 ? (
            <div className="muted text-sm">
              {willTag && plan.taggedExisting.length > 0
                ? "No new words to look up — the existing ones will just be tagged into the collection."
                : "Every word is already in your list — nothing to add."}
            </div>
          ) : (
            <p className="muted text-xs">
              Each new word is one AI lookup, so this can take a little while. You
              can leave the page once it finishes.
            </p>
          )}

          <div className="flex flex-col sm:flex-row gap-2">
            <button
              className="btn btn-primary flex-1"
              onClick={run}
              disabled={
                (plan.newWords.length === 0 &&
                  !(willTag && plan.taggedExisting.length > 0)) ||
                (plan.newWords.length > 0 && !hasLLM)
              }
            >
              {plan.newWords.length > 0
                ? `Add ${newCount} word${newCount === 1 ? "" : "s"}${willTag ? " + tag" : ""}`
                : `Tag ${plan.taggedExisting.length} word${plan.taggedExisting.length === 1 ? "" : "s"}`}
            </button>
            <button className="btn" onClick={() => setPhase("input")}>
              ← Edit list
            </button>
          </div>
        </div>
      )}

      {/* ── Running ── */}
      {phase === "running" && (
        <div className="card p-5 space-y-3">
          <div className="font-bold">
            Enriching {progress.done}/{progress.total}…
          </div>
          <div className="h-2.5 rounded-full overflow-hidden bg-black/5 dark:bg-white/10">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%`,
                background: "var(--accent)",
              }}
            />
          </div>
          <p className="muted text-sm">
            Looking up meaning, examples and synonyms for each word. This can take
            a bit — please keep this tab open.
          </p>
          <button className="btn w-fit" onClick={() => (cancelled.current = true)}>
            Stop after current batch
          </button>
        </div>
      )}

      {/* ── Done ── */}
      {phase === "done" && result && (
        <div className="card p-5 space-y-3">
          <div className="font-bold text-lg" style={{ color: "var(--good)" }}>
            {result.added.length > 0
              ? `Added ${result.added.length} word${result.added.length === 1 ? "" : "s"} 🎉`
              : "Done 🎉"}
          </div>

          {/* Transparent breakdown of exactly what happened. */}
          <ul className="text-sm space-y-1">
            <li>
              <b style={{ color: "var(--good)" }}>{result.added.length}</b> new
              word{result.added.length === 1 ? "" : "s"} added
              {result.collectionName ? (
                <> to <b>{result.collectionName}</b></>
              ) : null}
              .
            </li>
            {result.collectionName && (
              <li>
                <b>{result.taggedCount}</b> existing word
                {result.taggedCount === 1 ? "" : "s"} tagged into{" "}
                <b>{result.collectionName}</b> (not duplicated).
              </li>
            )}
            {result.duplicatesMerged > 0 && (
              <li className="muted">
                {result.duplicatesMerged} duplicate
                {result.duplicatesMerged === 1 ? "" : "s"} in your paste merged.
              </li>
            )}
            {result.failed.length > 0 && (
              <li style={{ color: "var(--bad)" }}>
                {result.failed.length} couldn&apos;t be looked up.
              </li>
            )}
          </ul>

          {result.quotaHit && (
            <div
              className="text-sm rounded-lg p-3"
              style={{ background: "var(--warn-soft)", border: "1px solid var(--warn)" }}
            >
              {result.quotaMessage ?? "You've reached today's lookup limit."}{" "}
              {result.added.length} added before stopping — paste the rest tomorrow.
            </div>
          )}

          {result.added.some((a) => a.corrected) && (
            <details className="text-sm">
              <summary className="muted cursor-pointer">
                Auto-corrected{" "}
                {result.added.filter((a) => a.corrected).length} spelling
                {result.added.filter((a) => a.corrected).length === 1 ? "" : "s"}
              </summary>
              <ul className="mt-2 space-y-1">
                {result.added
                  .filter((a) => a.corrected)
                  .map((a, i) => (
                    <li key={i} className="muted">
                      <b>{a.corrected}</b> → {a.word}
                    </li>
                  ))}
              </ul>
            </details>
          )}

          {result.failed.length > 0 && (
            <details className="text-sm">
              <summary className="muted cursor-pointer">
                {result.failed.length} failed — see why
              </summary>
              <ul className="mt-2 space-y-1">
                {result.failed.map((f, i) => (
                  <li key={i} className="muted">
                    <b>{f.word}</b>: {f.error}
                  </li>
                ))}
              </ul>
            </details>
          )}

          {error && (
            <p className="text-sm" style={{ color: "var(--bad)" }}>
              {error}
            </p>
          )}

          <div className="flex flex-wrap gap-2 pt-1">
            <a href="/practice" className="btn btn-primary">
              Start practising →
            </a>
            <a href="/library" className="btn">
              View library
            </a>
            <button className="btn" onClick={reset}>
              Import more
            </button>
          </div>
        </div>
      )}

      {error && phase !== "done" && (
        <div
          className="card p-3 text-sm"
          style={{ background: "var(--bad-soft)", borderColor: "var(--bad)" }}
        >
          {error}
        </div>
      )}

      {/* ── Advanced: original CSV importer, kept but tucked away ── */}
      {(phase === "input" || phase === "preview") && (
        <details className="card p-4">
          <summary className="cursor-pointer font-semibold text-sm">
            Advanced: import a CSV file
          </summary>
          <p className="muted text-sm mt-2 mb-3">
            Have a spreadsheet with meanings, examples or tags already? Import it
            here and map the columns.
          </p>
          <ImportWords />
        </details>
      )}
    </div>
  );
}

/** The "file this list into a collection" selector: none / existing / new. */
function CollectionTarget({
  mode,
  setMode,
  colId,
  setColId,
  newColName,
  setNewColName,
  collections,
}: {
  mode: ColMode;
  setMode: (m: ColMode) => void;
  colId: string;
  setColId: (id: string) => void;
  newColName: string;
  setNewColName: (n: string) => void;
  collections: { id: string; name: string; emoji?: string }[];
}) {
  const opts: { key: ColMode; label: string }[] = [
    { key: "none", label: "No collection" },
    { key: "existing", label: "Existing" },
    { key: "new", label: "New collection" },
  ];
  return (
    <div className="space-y-2">
      <span className="text-xs font-semibold muted">
        Add this list to a collection
      </span>
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Collection target">
        {opts.map((o) => {
          const on = mode === o.key;
          // "Existing" needs at least one of the user's own collections.
          const disabled = o.key === "existing" && collections.length === 0;
          return (
            <button
              key={o.key}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={disabled}
              onClick={() => setMode(o.key)}
              className="px-2.5 py-1 rounded-full text-sm font-semibold border transition-colors disabled:opacity-40"
              style={
                on
                  ? { background: "var(--accent)", borderColor: "var(--accent)", color: "var(--accent-ink)" }
                  : { borderColor: "var(--line)", color: "var(--muted)" }
              }
            >
              {o.label}
            </button>
          );
        })}
      </div>

      {mode === "existing" && collections.length > 0 && (
        <select
          className="input"
          value={colId}
          onChange={(e) => setColId(e.target.value)}
          aria-label="Choose a collection"
        >
          {collections.map((c) => (
            <option key={c.id} value={c.id}>
              {(c.emoji ? `${c.emoji} ` : "") + c.name}
            </option>
          ))}
        </select>
      )}

      {mode === "new" && (
        <input
          className="input"
          placeholder="New collection name (e.g. IELTS Task 1)"
          value={newColName}
          onChange={(e) => setNewColName(e.target.value)}
          maxLength={80}
          aria-label="New collection name"
        />
      )}
    </div>
  );
}
