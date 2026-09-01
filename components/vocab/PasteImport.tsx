"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { jsonFetch } from "@/lib/ui";
import { mutateAfterWordChange } from "@/lib/swr";
import { parsePasteList, MAX_PASTE_WORDS } from "@/lib/paste";
import ImportWords from "@/components/vocab/ImportWords";

type Phase = "input" | "preview" | "running" | "done";

interface Preview {
  newWords: string[];
  duplicates: string[]; // already in the library
  duplicatesInPaste: number; // repeats within the paste itself
  capped: boolean; // more new words than MAX_PASTE_WORDS
}

interface RunResult {
  added: { word: string; corrected?: string }[];
  skipped: string[];
  failed: { word: string; error: string }[];
  quotaHit: boolean;
  quotaMessage?: string;
}

const CHUNK = 4; // words per request — keeps progress lively and requests short

/**
 * Paste-a-word-list importer: the primary "Import" flow. The user pastes a list
 * of English words; we parse + dedupe, check them against their library BEFORE
 * spending any LLM quota (the cost gate), then enrich + add each new word
 * through the same pipeline single-word Add uses, with live progress and
 * graceful per-word / quota failure handling. The old CSV importer lives on as
 * a collapsed "Advanced" option.
 */
export default function PasteImport() {
  const [hasLLM, setHasLLM] = useState(true);
  const [text, setText] = useState("");
  const [phase, setPhase] = useState<Phase>("input");
  const [checking, setChecking] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [result, setResult] = useState<RunResult | null>(null);
  const [error, setError] = useState("");
  const cancelled = useRef(false);

  useEffect(() => {
    jsonFetch<{ hasLLM: boolean }>("/api/config")
      .then((c) => setHasLLM(c.hasLLM))
      .catch(() => {});
  }, []);

  // Live count as the user pastes — cheap, no network.
  const parsed = useMemo(() => parsePasteList(text), [text]);

  function reset() {
    setText("");
    setPhase("input");
    setPreview(null);
    setResult(null);
    setError("");
    setProgress({ done: 0, total: 0 });
  }

  async function check() {
    setError("");
    const { words, duplicatesInPaste } = parsed;
    if (words.length === 0) return;
    setChecking(true);
    try {
      const { existing } = await jsonFetch<{ existing: string[] }>(
        "/api/words/check-bulk",
        { method: "POST", body: JSON.stringify({ words }) },
      );
      const dupSet = new Set(existing.map((w) => w.toLowerCase()));
      const newWords = words.filter((w) => !dupSet.has(w.toLowerCase()));
      setPreview({
        newWords,
        duplicates: words.filter((w) => dupSet.has(w.toLowerCase())),
        duplicatesInPaste,
        capped: newWords.length > MAX_PASTE_WORDS,
      });
      setPhase("preview");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setChecking(false);
    }
  }

  async function run() {
    if (!preview) return;
    const queue = preview.newWords.slice(0, MAX_PASTE_WORDS);
    cancelled.current = false;
    setPhase("running");
    setProgress({ done: 0, total: queue.length });

    const acc: RunResult = { added: [], skipped: [], failed: [], quotaHit: false };
    try {
      for (let i = 0; i < queue.length; i += CHUNK) {
        if (cancelled.current) break;
        const chunk = queue.slice(i, i + CHUNK);
        const res = await jsonFetch<{
          added: { word: string; corrected?: string }[];
          skipped: string[];
          failed: { word: string; error: string }[];
          quotaExhausted: boolean;
          quotaMessage?: string;
        }>("/api/words/import-paste", {
          method: "POST",
          body: JSON.stringify({ words: chunk }),
        });
        acc.added.push(...res.added);
        acc.skipped.push(...res.skipped);
        acc.failed.push(...res.failed);
        setProgress({ done: Math.min(i + chunk.length, queue.length), total: queue.length });
        if (res.quotaExhausted) {
          acc.quotaHit = true;
          acc.quotaMessage = res.quotaMessage;
          break; // stop cleanly — daily limit reached
        }
      }
      setResult(acc);
      setPhase("done");
    } catch (e) {
      // Network/unexpected error mid-run: keep whatever succeeded.
      setResult({ ...acc, failed: acc.failed });
      setError(e instanceof Error ? e.message : String(e));
      setPhase("done");
    } finally {
      // Some words may have been imported even on a partial failure — refresh
      // the Library list, stats and collection counts.
      if (acc.added.length) void mutateAfterWordChange();
    }
  }

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
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:justify-between">
            <span className="muted text-sm">
              {parsed.words.length > 0
                ? `${parsed.words.length} word${parsed.words.length === 1 ? "" : "s"} detected`
                : "Nothing pasted yet"}
              {parsed.duplicatesInPaste > 0 &&
                ` · ${parsed.duplicatesInPaste} repeat${parsed.duplicatesInPaste === 1 ? "" : "s"} in your paste ignored`}
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
      {phase === "preview" && preview && (
        <div className="card p-5 space-y-4">
          <div>
            <div className="font-bold text-lg">Ready to import</div>
            <p className="text-sm mt-1">
              <b style={{ color: "var(--good)" }}>
                {preview.newWords.length} new word
                {preview.newWords.length === 1 ? "" : "s"}
              </b>
              {preview.duplicates.length > 0 && (
                <>
                  {" · "}
                  <span className="muted">
                    {preview.duplicates.length} already in your list (skipped)
                  </span>
                </>
              )}
            </p>
          </div>

          {preview.capped && (
            <div
              className="text-sm rounded-lg p-3"
              style={{ background: "var(--warn-soft)", border: "1px solid var(--warn)" }}
            >
              That&apos;s a big list. To protect your daily limit, only the first{" "}
              <b>{MAX_PASTE_WORDS}</b> new words will be imported this run — paste
              the rest afterwards.
            </div>
          )}

          {preview.newWords.length > 0 && (
            <div className="text-sm">
              <div className="flex flex-wrap gap-1.5 max-h-32 overflow-auto">
                {preview.newWords.slice(0, MAX_PASTE_WORDS).slice(0, 40).map((w, i) => (
                  <span
                    key={i}
                    className="px-2 py-0.5 rounded-full"
                    style={{ background: "var(--accent-soft, rgba(0,0,0,0.05))" }}
                  >
                    {w}
                  </span>
                ))}
                {Math.min(preview.newWords.length, MAX_PASTE_WORDS) > 40 && (
                  <span className="muted px-1 py-0.5">
                    +{Math.min(preview.newWords.length, MAX_PASTE_WORDS) - 40} more
                  </span>
                )}
              </div>
            </div>
          )}

          {preview.newWords.length === 0 ? (
            <div className="muted text-sm">
              Every word is already in your list — nothing to add.
            </div>
          ) : (
            <p className="muted text-xs">
              Each word is one AI lookup, so this can take a little while. You can
              leave the page once it finishes.
            </p>
          )}

          <div className="flex flex-col sm:flex-row gap-2">
            <button
              className="btn btn-primary flex-1"
              onClick={run}
              disabled={preview.newWords.length === 0 || !hasLLM}
            >
              Add {Math.min(preview.newWords.length, MAX_PASTE_WORDS)} word
              {Math.min(preview.newWords.length, MAX_PASTE_WORDS) === 1 ? "" : "s"}
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
            Added {result.added.length} word{result.added.length === 1 ? "" : "s"} 🎉
          </div>
          <div className="muted text-sm">
            {result.skipped.length > 0 &&
              `Skipped ${result.skipped.length} duplicate${result.skipped.length === 1 ? "" : "s"}. `}
            {result.failed.length > 0 &&
              `${result.failed.length} couldn't be looked up.`}
            {result.skipped.length === 0 && result.failed.length === 0 && "All done."}
          </div>

          {result.quotaHit && (
            <div
              className="text-sm rounded-lg p-3"
              style={{ background: "var(--warn-soft)", border: "1px solid var(--warn)" }}
            >
              {result.quotaMessage ??
                "You've reached today's lookup limit."}{" "}
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
