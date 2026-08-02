"use client";

import { useEffect, useMemo, useState } from "react";
import type { NewWord } from "@/lib/store";
import { jsonFetch } from "@/lib/ui";

const TARGETS = [
  { key: "word", label: "English word", required: true },
  { key: "part_of_speech", label: "Part of speech" },
  { key: "vi_meaning", label: "Vietnamese meaning" },
  { key: "example_simple", label: "Example sentence" },
  { key: "personal_note", label: "Note" },
  { key: "tags", label: "Tags" },
] as const;
type TargetKey = (typeof TARGETS)[number]["key"];

export default function ImportPage() {
  const [hasLLM, setHasLLM] = useState(false);
  const [rows, setRows] = useState<string[][]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [map, setMap] = useState<Record<TargetKey, number>>(
    {} as Record<TargetKey, number>,
  );
  const [enrich, setEnrich] = useState(true);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(
    null,
  );
  const [summary, setSummary] = useState<{
    created: number;
    skipped: number;
    errors: { word: string; error: string }[];
  } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    jsonFetch<{ hasLLM: boolean }>("/api/config").then((c) => {
      setHasLLM(c.hasLLM);
      setEnrich(c.hasLLM);
    });
  }, []);

  function ingest(text: string) {
    const parsed = parseCSV(text);
    if (parsed.length < 1) return;
    const hdr = parsed[0];
    setHeaders(hdr);
    setRows(parsed.slice(1));
    setMap(autoMap(hdr));
    setSummary(null);
    setError("");
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    file.text().then(ingest);
  }

  const wordCol = map.word;
  const preview: NewWord[] = useMemo(() => {
    return rows
      .map((r) => rowToWord(r, map))
      .filter((w): w is NewWord => !!w && !!w.word);
  }, [rows, map]);

  async function runImport() {
    setError("");
    setProgress({ done: 0, total: preview.length });
    const chunkSize = 8;
    let created = 0;
    let skipped = 0;
    const errors: { word: string; error: string }[] = [];
    try {
      for (let i = 0; i < preview.length; i += chunkSize) {
        const chunk = preview.slice(i, i + chunkSize);
        const res = await jsonFetch<{
          created: number;
          skipped: number;
          errors: { word: string; error: string }[];
        }>("/api/import", {
          method: "POST",
          body: JSON.stringify({ rows: chunk, enrich }),
        });
        created += res.created;
        skipped += res.skipped ?? 0;
        errors.push(...res.errors);
        setProgress({ done: Math.min(i + chunkSize, preview.length), total: preview.length });
      }
      setSummary({ created, skipped, errors });
      setProgress(null);
    } catch (e: any) {
      setError(e.message);
      setProgress(null);
    }
  }

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-extrabold">Import CSV</h1>
      <p className="muted text-sm">
        Load your word list once. Pick which column is which; the AI fills the
        rest for each word.
      </p>

      {rows.length === 0 && (
        <div className="card p-6 space-y-3">
          <label className="btn btn-primary cursor-pointer w-fit">
            Choose CSV file
            <input type="file" accept=".csv,text/csv" hidden onChange={onFile} />
          </label>
          <div className="muted text-sm">or paste CSV text:</div>
          <textarea
            className="input min-h-[8rem] font-mono text-sm"
            placeholder="word,part of speech,meaning,example&#10;reluctant,adjective,miễn cưỡng,She was reluctant to leave."
            onChange={(e) => e.target.value.trim() && ingest(e.target.value)}
          />
        </div>
      )}

      {rows.length > 0 && !summary && (
        <>
          <div className="card p-5 space-y-3">
            <div className="font-bold">
              {rows.length} rows · map your columns
            </div>
            <div className="space-y-2">
              {TARGETS.map((t) => (
                <div key={t.key} className="flex items-center gap-3">
                  <div className="w-40 text-sm font-semibold">
                    {t.label}
                    {"required" in t && t.required && (
                      <span style={{ color: "var(--bad)" }}> *</span>
                    )}
                  </div>
                  <select
                    className="input"
                    value={map[t.key] ?? -1}
                    onChange={(e) =>
                      setMap({ ...map, [t.key]: Number(e.target.value) })
                    }
                  >
                    <option value={-1}>— none —</option>
                    {headers.map((h, i) => (
                      <option key={i} value={i}>
                        {h || `Column ${i + 1}`}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </div>

          <div className="card p-5 space-y-3">
            <div className="font-bold">Preview ({preview.length} words)</div>
            {wordCol === undefined || wordCol < 0 ? (
              <p style={{ color: "var(--bad)" }} className="text-sm">
                Pick the “English word” column to continue.
              </p>
            ) : (
              <div className="text-sm space-y-1 max-h-40 overflow-auto">
                {preview.slice(0, 6).map((w, i) => (
                  <div key={i} className="flex gap-2">
                    <span className="font-semibold">{w.word}</span>
                    <span className="muted truncate">{w.vi_meaning ?? ""}</span>
                  </div>
                ))}
                {preview.length > 6 && (
                  <div className="muted">…and {preview.length - 6} more</div>
                )}
              </div>
            )}

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={enrich}
                disabled={!hasLLM}
                onChange={(e) => setEnrich(e.target.checked)}
              />
              Enrich each word with the AI
              {!hasLLM && <span className="muted">(needs API key)</span>}
            </label>

            {progress ? (
              <div className="space-y-2">
                <div className="h-2 rounded-full overflow-hidden bg-black/5 dark:bg-white/10">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${(progress.done / progress.total) * 100}%`,
                      background: "var(--accent)",
                    }}
                  />
                </div>
                <div className="muted text-sm">
                  Importing {progress.done}/{progress.total}…
                  {enrich && " (enriching — this can take a bit)"}
                </div>
              </div>
            ) : (
              <button
                className="btn btn-primary w-full"
                onClick={runImport}
                disabled={preview.length === 0 || wordCol === undefined || wordCol < 0}
              >
                Import {preview.length} words
              </button>
            )}
          </div>
        </>
      )}

      {error && (
        <div
          className="card p-3 text-sm"
          style={{ background: "var(--bad-soft)", borderColor: "var(--bad)" }}
        >
          {error}
        </div>
      )}

      {summary && (
        <div className="card p-5 space-y-2">
          <div className="font-bold text-lg" style={{ color: "var(--good)" }}>
            Imported {summary.created} words 🎉
          </div>
          {summary.skipped > 0 && (
            <div className="muted text-sm">
              Skipped {summary.skipped} already in your library.
            </div>
          )}
          {summary.errors.length > 0 && (
            <details className="text-sm">
              <summary className="muted cursor-pointer">
                {summary.errors.length} enrichment warnings (saved anyway)
              </summary>
              <ul className="mt-2 space-y-1">
                {summary.errors.map((e, i) => (
                  <li key={i} className="muted">
                    <b>{e.word}</b>: {e.error}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <div className="flex gap-2 pt-1">
            <a href="/practice" className="btn btn-primary">
              Start practising →
            </a>
            <a href="/library" className="btn">
              View library
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── helpers ── */

function autoMap(headers: string[]): Record<TargetKey, number> {
  const m = {} as Record<TargetKey, number>;
  const find = (...keys: string[]) =>
    headers.findIndex((h) =>
      keys.some((k) => h.toLowerCase().replace(/[_\s-]/g, "").includes(k)),
    );
  m.word = find("word", "term", "english", "vocab");
  if (m.word < 0) m.word = 0;
  m.part_of_speech = find("pos", "partofspeech", "type", "wordclass");
  m.vi_meaning = find("meaning", "vietnamese", "vn", "nghĩa", "translation");
  m.example_simple = find("example", "sentence", "usage", "vídụ", "vidu");
  m.personal_note = find("note", "comment", "ghichú", "ghichu");
  m.tags = find("tag", "topic", "category", "chủđề");
  return m;
}

function rowToWord(r: string[], map: Record<TargetKey, number>): NewWord | null {
  const get = (k: TargetKey) => {
    const i = map[k];
    return i !== undefined && i >= 0 ? (r[i] ?? "").trim() : "";
  };
  const word = get("word");
  if (!word) return null;
  const tagsRaw = get("tags");
  return {
    word,
    part_of_speech: get("part_of_speech") || undefined,
    vi_meaning: get("vi_meaning") || undefined,
    example_simple: get("example_simple") || undefined,
    personal_note: get("personal_note") || undefined,
    tags: tagsRaw ? tagsRaw.split(/[;,|]/).map((t) => t.trim()).filter(Boolean) : undefined,
    source: "csv",
  };
}

function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cur += '"';
          i++;
        } else q = false;
      } else cur += c;
    } else {
      if (c === '"') q = true;
      else if (c === ",") {
        row.push(cur);
        cur = "";
      } else if (c === "\r") {
        /* skip */
      } else if (c === "\n") {
        row.push(cur);
        rows.push(row);
        row = [];
        cur = "";
      } else cur += c;
    }
  }
  if (cur !== "" || row.length) {
    row.push(cur);
    rows.push(row);
  }
  return rows.filter((r) => r.some((x) => x.trim() !== ""));
}
