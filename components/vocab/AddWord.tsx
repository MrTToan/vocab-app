"use client";

import { useEffect, useRef, useState } from "react";
import type { Collection, Enrichment, Word } from "@/lib/types";
import { jsonFetch } from "@/lib/ui";

type Fields = Enrichment & { personal_note: string; tags: string };

const EMPTY: Fields = {
  part_of_speech: "",
  ipa: "",
  vi_meaning: "",
  definition_en: "",
  synonyms: [],
  collocations: [],
  example_simple: "",
  example_complex: "",
  false_friend_note: "",
  personal_note: "",
  tags: "",
};

/**
 * Single-word add flow with live duplicate check, "did you mean" spelling
 * correction, LLM enrichment and collection assignment. Extracted from the old
 * /add page so it can share the combined Add page with the CSV importer.
 */
export default function AddWord() {
  const [hasLLM, setHasLLM] = useState(false);
  const [word, setWord] = useState("");
  const [phase, setPhase] = useState<"input" | "review">("input");
  const [fields, setFields] = useState<Fields>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [savedMsg, setSavedMsg] = useState("");
  const [dup, setDup] = useState<{ id: string; word: string; vi_meaning: string } | null>(
    null,
  );
  const [suggestion, setSuggestion] = useState(""); // spelling correction from enrichment
  const [collections, setCollections] = useState<Collection[]>([]);
  const [selectedCollections, setSelectedCollections] = useState<Set<string>>(
    new Set(),
  );
  const wordRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    jsonFetch<{ hasLLM: boolean }>("/api/config").then((c) => setHasLLM(c.hasLLM));
    jsonFetch<{ collections: Collection[] }>("/api/collections")
      .then((r) => setCollections(r.collections))
      .catch(() => {});
  }, []);

  // duplicate check (debounced) as the word is typed
  useEffect(() => {
    const w = word.trim();
    if (!w) {
      setDup(null);
      return;
    }
    const t = setTimeout(() => {
      jsonFetch<{ exists: boolean; match?: { id: string; word: string; vi_meaning: string } }>(
        `/api/words/check?word=${encodeURIComponent(w)}`,
      )
        .then((r) => setDup(r.exists && r.match ? r.match : null))
        .catch(() => {});
    }, 400);
    return () => clearTimeout(t);
  }, [word]);

  async function enrich(term: string = word) {
    if (!term.trim()) return;
    setBusy(true);
    setError("");
    try {
      const { enrichment, spellingSuggestion } = await jsonFetch<{
        enrichment: Enrichment;
        spellingSuggestion?: string;
      }>("/api/enrich", {
        method: "POST",
        body: JSON.stringify({ word: term }),
      });
      setFields({ ...enrichment, personal_note: "", tags: "" });
      setSuggestion(spellingSuggestion ?? "");
      setPhase("review");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  /** Accept the spelling correction: swap the word and re-enrich it clean. */
  function acceptSuggestion() {
    const corrected = suggestion;
    setWord(corrected);
    setSuggestion("");
    enrich(corrected);
  }

  function startManual() {
    setFields(EMPTY);
    setSuggestion("");
    setPhase("review");
  }

  async function save() {
    setBusy(true);
    setError("");
    try {
      const body = {
        word,
        part_of_speech: fields.part_of_speech,
        ipa: fields.ipa,
        vi_meaning: fields.vi_meaning,
        definition_en: fields.definition_en,
        synonyms: fields.synonyms,
        collocations: fields.collocations,
        example_simple: fields.example_simple,
        example_complex: fields.example_complex,
        false_friend_note: fields.false_friend_note,
        personal_note: fields.personal_note,
        tags: fields.tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        source: "manual" as const,
        enrich: false,
        allow_duplicate: !!dup, // user has seen the warning
        collectionIds: [...selectedCollections],
      };
      await jsonFetch<{ word: Word }>("/api/words", {
        method: "POST",
        body: JSON.stringify(body),
      });
      setSavedMsg(`Saved “${word}”.`);
      setWord("");
      setFields(EMPTY);
      setPhase("input");
      setDup(null);
      setSuggestion("");
      // keep the collection selection — adding several words to the same set is common
      wordRef.current?.focus();
    } catch (e: any) {
      setError(
        e.message === "duplicate"
          ? "That word is already in your library."
          : e.message,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      {savedMsg && (
        <div
          className="card p-3 text-sm"
          style={{ background: "var(--good-soft)", borderColor: "var(--good)" }}
        >
          {savedMsg}
        </div>
      )}

      <div className="card p-5 space-y-3">
        <label className="block">
          <span className="text-sm font-semibold">English word or phrase</span>
          <div className="flex gap-2 mt-1">
            <input
              ref={wordRef}
              className="input"
              placeholder="e.g. reluctant"
              value={word}
              onChange={(e) => {
                setWord(e.target.value);
                setSuggestion("");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && phase === "input") {
                  hasLLM ? enrich() : startManual();
                }
              }}
              autoFocus
            />
            {phase === "input" &&
              (hasLLM ? (
                <button
                  className="btn btn-primary whitespace-nowrap"
                  onClick={() => enrich()}
                  disabled={busy || !word.trim()}
                >
                  {busy ? "Enriching…" : "Enrich →"}
                </button>
              ) : (
                <button
                  className="btn whitespace-nowrap"
                  onClick={startManual}
                  disabled={!word.trim()}
                >
                  Fill in →
                </button>
              ))}
          </div>
        </label>
        {phase === "input" && (
          <p className="muted text-xs">
            {hasLLM
              ? "The AI drafts meaning, examples, synonyms and usage traps — you review before saving."
              : "No API key set — you'll fill the fields yourself. Add a key later for auto-enrichment."}
          </p>
        )}
      </div>

      {dup && (
        <div
          className="card p-3 text-sm"
          style={{ background: "var(--warn-soft)", borderColor: "var(--warn)" }}
        >
          ⚠ <b>“{dup.word}”</b> is already in your library
          {dup.vi_meaning ? <> — {dup.vi_meaning}</> : null}.{" "}
          <a href="/library" className="underline">
            View
          </a>
          . You can still add it if you want a second entry.
        </div>
      )}

      {suggestion && (
        <div
          className="card p-3 text-sm"
          style={{ background: "var(--warn-soft)", borderColor: "var(--warn)" }}
        >
          ⚠ <b>“{word}”</b> looks like a misspelling of <b>“{suggestion}”</b>.{" "}
          <button
            type="button"
            className="underline font-semibold"
            onClick={acceptSuggestion}
            disabled={busy}
          >
            Use “{suggestion}”
          </button>
          <span className="muted"> — or keep your spelling and save below.</span>
        </div>
      )}

      {error && (
        <div
          className="card p-3 text-sm"
          style={{ background: "var(--bad-soft)", borderColor: "var(--bad)" }}
        >
          {error}
        </div>
      )}

      {phase === "review" && (
        <div className="card p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="font-bold text-lg">{word}</div>
            <button
              className="btn text-sm"
              onClick={() => setPhase("input")}
              disabled={busy}
            >
              ← Back
            </button>
          </div>

          <Grid>
            <Field
              label="Part of speech"
              value={fields.part_of_speech}
              onChange={(v) => setFields({ ...fields, part_of_speech: v })}
            />
            <Field
              label="IPA"
              value={fields.ipa}
              onChange={(v) => setFields({ ...fields, ipa: v })}
            />
          </Grid>
          <Field
            label="Vietnamese meaning"
            value={fields.vi_meaning}
            onChange={(v) => setFields({ ...fields, vi_meaning: v })}
          />
          <Field
            label="English definition"
            value={fields.definition_en}
            onChange={(v) => setFields({ ...fields, definition_en: v })}
          />
          <Field
            label="Example (simple)"
            value={fields.example_simple}
            onChange={(v) => setFields({ ...fields, example_simple: v })}
            textarea
          />
          <Field
            label="Example (complex)"
            value={fields.example_complex}
            onChange={(v) => setFields({ ...fields, example_complex: v })}
            textarea
          />
          <Grid>
            <Field
              label="Synonyms (comma-sep)"
              value={fields.synonyms.join(", ")}
              onChange={(v) =>
                setFields({
                  ...fields,
                  synonyms: v.split(",").map((s) => s.trim()).filter(Boolean),
                })
              }
            />
            <Field
              label="Collocations (comma-sep)"
              value={fields.collocations.join(", ")}
              onChange={(v) =>
                setFields({
                  ...fields,
                  collocations: v.split(",").map((s) => s.trim()).filter(Boolean),
                })
              }
            />
          </Grid>
          <Field
            label="Usage trap / false-friend note"
            value={fields.false_friend_note}
            onChange={(v) => setFields({ ...fields, false_friend_note: v })}
          />
          <Grid>
            <Field
              label="Your note (mnemonic)"
              value={fields.personal_note}
              onChange={(v) => setFields({ ...fields, personal_note: v })}
            />
            <Field
              label="Tags (comma-sep)"
              value={fields.tags}
              onChange={(v) => setFields({ ...fields, tags: v })}
            />
          </Grid>

          {collections.length > 0 && (
            <div>
              <span className="text-xs font-semibold muted">
                Add to collections
              </span>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {collections.map((c) => {
                  const on = selectedCollections.has(c.id);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() =>
                        setSelectedCollections((prev) => {
                          const next = new Set(prev);
                          if (next.has(c.id)) next.delete(c.id);
                          else next.add(c.id);
                          return next;
                        })
                      }
                      className="px-2.5 py-1 rounded-full text-sm font-semibold border transition-colors"
                      style={
                        on
                          ? { background: "var(--accent)", borderColor: "var(--accent)", color: "#fff" }
                          : { borderColor: "var(--line)", color: "var(--muted)" }
                      }
                    >
                      {(c.emoji ? `${c.emoji} ` : "") + c.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <button
            className="btn btn-primary w-full"
            onClick={save}
            disabled={busy}
          >
            {busy ? "Saving…" : dup ? "Save anyway" : "Save word"}
          </button>
        </div>
      )}
    </div>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{children}</div>;
}

function Field({
  label,
  value,
  onChange,
  textarea,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  textarea?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-xs font-semibold muted">{label}</span>
      {textarea ? (
        <textarea
          className="input mt-1 min-h-[3.5rem] resize-y"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          className="input mt-1"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </label>
  );
}
