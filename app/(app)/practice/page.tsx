"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ExerciseType,
  GeneratedExercise,
  Result,
  Score,
  Stage,
  Word,
} from "@/lib/types";
import { STAGE_LABEL, STAGE_ORDER, RESULT_VAR, jsonFetch } from "@/lib/ui";
import { gradeEnglishWord, matchesMeaning } from "@/lib/grade";

interface Payload {
  word: Word | null;
  exerciseType?: ExerciseType;
  generated?: GeneratedExercise;
}
interface Current {
  word: Word;
  exerciseType: ExerciseType;
  generated: GeneratedExercise;
  flashDir: "vn2en" | "en2vn";
}

const LABEL: Record<ExerciseType, string> = {
  multiple_choice: "Choose the meaning",
  flashcard: "Flashcard",
  cloze: "Fill in the blank",
  type_from_definition: "Type the word",
  write_sentence: "Write a sentence",
  translate: "Translate",
  scenario: "Use it in context",
};

// Don't repeat a word within this many picks (a cooldown, not a full-session ban),
// so the active working set can cycle and exercises vary.
const COOLDOWN = 4;

export default function PracticePage() {
  const recent = useRef<string[]>([]);
  const buffer = useRef<Payload | null>(null);
  const explore = useRef(false); // "new words" mode: pick fresh/random words
  const [cur, setCur] = useState<Current | null>(null);
  const [status, setStatus] = useState<
    "loading" | "answer" | "grading" | "confirm" | "feedback" | "empty"
  >("loading");
  const [answer, setAnswer] = useState("");
  const [reveal, setReveal] = useState(false); // flashcard back shown
  const [result, setResult] = useState<Result | null>(null);
  const [score, setScore] = useState<Score | null>(null);
  const [stageChange, setStageChange] = useState<{ from: Stage; to: Stage } | null>(null);
  const [stats, setStats] = useState({ done: 0, correct: 0 });
  const [exploring, setExploring] = useState(false);
  const [error, setError] = useState("");

  const toCurrent = (p: Payload): Current | null => {
    if (!p.word || !p.exerciseType) return null;
    return {
      word: p.word,
      exerciseType: p.exerciseType,
      generated: p.generated ?? {},
      flashDir: Math.random() < 0.5 ? "vn2en" : "en2vn",
    };
  };

  const fetchNext = useCallback(async (): Promise<Payload> => {
    return jsonFetch<Payload>("/api/practice/next", {
      method: "POST",
      body: JSON.stringify({
        seenIds: recent.current.slice(-COOLDOWN),
        explore: explore.current,
      }),
    });
  }, []);

  const present = useCallback((p: Payload) => {
    const c = toCurrent(p);
    if (!c) {
      setStatus("empty");
      setCur(null);
      return;
    }
    recent.current.push(c.word.id);
    if (recent.current.length > 50) recent.current = recent.current.slice(-50);
    setCur(c);
    setAnswer("");
    setReveal(false);
    setResult(null);
    setScore(null);
    setStageChange(null);
    setStatus("answer");
    // prefetch the following exercise so transitions feel instant
    fetchNext().then((next) => (buffer.current = next)).catch(() => {});
  }, [fetchNext]);

  const advance = useCallback(async () => {
    setStatus("loading");
    setError("");
    try {
      if (buffer.current) {
        const b = buffer.current;
        buffer.current = null;
        present(b);
      } else {
        present(await fetchNext());
      }
    } catch (e: any) {
      setError(e.message);
      setStatus("answer");
    }
  }, [fetchNext, present]);

  useEffect(() => {
    fetchNext().then(present).catch((e) => {
      setError(e.message);
      setStatus("empty");
    });
  }, [fetchNext, present]);

  /** Toggle "new words" mode and immediately jump to a word in the new mode. */
  const toggleExplore = useCallback(() => {
    explore.current = !explore.current;
    setExploring(explore.current);
    buffer.current = null; // drop the word prefetched in the previous mode
    advance();
  }, [advance]);

  /** Record a graded result and show the stage change. */
  async function record(word: Word, r: Result) {
    setResult(r);
    setStats((s) => ({ done: s.done + 1, correct: s.correct + (r === "correct" ? 1 : 0) }));
    try {
      const res = await jsonFetch<{ from: Stage; stage: Stage }>(
        "/api/practice/result",
        {
          method: "POST",
          body: JSON.stringify({
            wordId: word.id,
            result: r,
            exerciseType: cur?.exerciseType,
          }),
        },
      );
      if (res.from !== res.stage) setStageChange({ from: res.from, to: res.stage });
    } catch {
      /* non-fatal */
    }
    setStatus("feedback");
  }

  /** Typed English exercises (cloze, type-from-definition, flashcard VN→EN). */
  function gradeLocal() {
    if (!cur) return;
    // cloze from the bank carries the exact blank answer (may be an inflected form)
    const target =
      cur.exerciseType === "cloze" && cur.generated.answer
        ? cur.generated.answer
        : cur.word.word;
    record(cur.word, gradeEnglishWord(answer, target));
  }

  /** Flashcard grading — direction-aware, no LLM. */
  function gradeFlashcard() {
    if (!cur) return;
    if (cur.flashDir === "vn2en") {
      record(cur.word, gradeEnglishWord(answer, cur.word.word));
    } else {
      // EN→VN: fuzzy-match the meaning; ask only on a genuine miss
      if (matchesMeaning(answer, cur.word.vi_meaning)) record(cur.word, "correct");
      else setStatus("confirm");
    }
  }

  /** LLM grading for write/translate/scenario. */
  async function gradeLLM() {
    if (!cur) return;
    setStatus("grading");
    setError("");
    try {
      const { score } = await jsonFetch<{ score: Score }>("/api/practice/score", {
        method: "POST",
        body: JSON.stringify({
          wordId: cur.word.id,
          exerciseType: cur.exerciseType,
          generated: cur.generated,
          answer,
        }),
      });
      setScore(score);
      const r: Result =
        score.verdict === "pass" ? "correct" : score.verdict === "partial" ? "partial" : "incorrect";
      record(cur.word, r);
    } catch (e: any) {
      setError(e.message);
      setStatus("answer");
    }
  }

  if (status === "empty") {
    return (
      <div className="card p-8 text-center space-y-3">
        <div className="text-2xl font-extrabold">No words to practise yet</div>
        <p className="muted">Add a few words, then come back.</p>
        <div className="flex gap-2 justify-center">
          <Link href="/add" className="btn btn-primary">Add a word</Link>
          <Link href="/import" className="btn">Import CSV</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between text-sm muted">
        <span>Session: {stats.done} done · {stats.correct} strong</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={toggleExplore}
            className="chip"
            style={
              exploring
                ? { background: "var(--accent)", color: "#fff", fontWeight: 600 }
                : undefined
            }
            title="Pull in random words you haven't started yet"
          >
            {exploring ? "✓ Exploring — back to review" : "🔀 Explore new words"}
          </button>
          {cur && <span className="chip">{LABEL[cur.exerciseType]}</span>}
        </div>
      </div>

      {status === "loading" || !cur ? (
        <div className="card p-10 text-center muted">Loading…</div>
      ) : (
        <div className="card p-6 space-y-5">
          <Prompt cur={cur} reveal={reveal} />

          {/* ── answer inputs ── */}
          {status === "answer" && (
            <AnswerArea
              cur={cur}
              answer={answer}
              setAnswer={setAnswer}
              onLocal={gradeLocal}
              onFlashCheck={gradeFlashcard}
              onLLM={gradeLLM}
            />
          )}
          {status === "grading" && (
            <div className="muted text-sm">Scoring your answer…</div>
          )}
          {status === "confirm" && (
            <ConfirmMeaning
              word={cur.word}
              answer={answer}
              onChoose={(r) => record(cur.word, r)}
            />
          )}

          {/* ── feedback ── */}
          {status === "feedback" && (
            <Feedback
              cur={cur}
              answer={answer}
              result={result}
              score={score}
              stageChange={stageChange}
              onNext={advance}
            />
          )}
        </div>
      )}

      {error && (
        <div className="card p-3 text-sm" style={{ background: "var(--bad-soft)", borderColor: "var(--bad)" }}>
          {error}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────  Prompt  ───────────────────────── */

function Prompt({ cur, reveal }: { cur: Current; reveal: boolean }) {
  const { word, exerciseType, generated, flashDir } = cur;
  switch (exerciseType) {
    case "flashcard":
      return flashDir === "en2vn" ? (
        <div className="text-center space-y-2 py-2">
          <div className="muted text-xs uppercase tracking-wide">
            English → Vietnamese
          </div>
          <div className="muted text-sm">Type the Vietnamese meaning of:</div>
          <div className="text-3xl font-extrabold">{word.word}</div>
        </div>
      ) : (
        <div className="text-center space-y-2 py-2">
          <div className="muted text-xs uppercase tracking-wide">
            Vietnamese → English
          </div>
          <div className="muted text-sm">Type the English word for this meaning:</div>
          <div className="text-2xl font-extrabold">{word.vi_meaning || word.word}</div>
        </div>
      );
    case "cloze":
      return (
        <div className="space-y-2">
          <div className="muted text-sm">Fill the blank with the target word:</div>
          <div className="text-xl leading-relaxed">
            {generated.cloze_sentence ?? "____"}
          </div>
          {word.vi_meaning && <div className="muted text-sm">Hint: {word.vi_meaning}</div>}
        </div>
      );
    case "type_from_definition":
      return (
        <div className="space-y-2">
          <div className="muted text-sm">Type the English word:</div>
          <div className="text-lg">
            <b>Meaning:</b> {word.vi_meaning}
          </div>
          {word.definition_en && (
            <div className="muted">{word.definition_en}</div>
          )}
        </div>
      );
    case "write_sentence":
      return (
        <div className="space-y-1">
          <div className="muted text-sm">Write a natural sentence using:</div>
          <div className="text-2xl font-extrabold">{word.word}</div>
          <div className="muted text-sm">{word.vi_meaning}</div>
        </div>
      );
    case "translate":
      return (
        <div className="space-y-2">
          <div className="muted text-sm">
            Translate into {generated.translate_direction === "vn_to_en" ? "English" : "Vietnamese"}
            {generated.translate_direction === "vn_to_en" && (
              <> (use “{word.word}”)</>
            )}:
          </div>
          <div className="text-xl">{generated.translate_source}</div>
        </div>
      );
    case "scenario":
      return (
        <div className="space-y-2">
          <div className="muted text-sm">Respond appropriately using “{word.word}”:</div>
          <div className="text-lg">{generated.scenario_prompt}</div>
        </div>
      );
    default:
      return <div className="text-2xl font-bold">{word.word}</div>;
  }
}

/* ─────────────────────────  Answer area  ───────────────────────── */

function AnswerArea({
  cur,
  answer,
  setAnswer,
  onLocal,
  onFlashCheck,
  onLLM,
}: {
  cur: Current;
  answer: string;
  setAnswer: (s: string) => void;
  onLocal: () => void;
  onFlashCheck: () => void;
  onLLM: () => void;
}) {
  const t = cur.exerciseType;
  const isLLM = t === "write_sentence" || t === "translate" || t === "scenario";
  const isFlash = t === "flashcard";
  const short = isFlash || t === "cloze" || t === "type_from_definition";
  const submit = isLLM ? onLLM : isFlash ? onFlashCheck : onLocal;
  const placeholder = isFlash
    ? cur.flashDir === "en2vn"
      ? "Type the Vietnamese meaning…"
      : "Type the English word…"
    : short
      ? "Your answer…"
      : "Write in English…";

  return (
    <div className="space-y-3">
      {short ? (
        <input
          className="input text-lg"
          placeholder={placeholder}
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && answer.trim() && submit()}
          autoFocus
        />
      ) : (
        <textarea
          className="input min-h-[5rem] text-lg resize-y"
          placeholder={placeholder}
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          autoFocus
        />
      )}
      <button
        className="btn btn-primary w-full"
        disabled={!answer.trim()}
        onClick={submit}
      >
        {isLLM ? "Check my answer" : "Check"}
      </button>
    </div>
  );
}

/* ─────────────────────────  Confirm (EN→VN fuzzy miss)  ───────────────────────── */

function ConfirmMeaning({
  word,
  answer,
  onChoose,
}: {
  word: Word;
  answer: string;
  onChoose: (r: Result) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="rounded-xl p-3" style={{ background: "var(--warn-soft)" }}>
        <div className="text-sm">
          Your answer: <b>{answer}</b>
        </div>
        <div className="text-sm">
          Stored meaning: <b>{word.vi_meaning}</b>
        </div>
        <div className="muted text-xs mt-1">
          Your wording didn&apos;t exactly match what&apos;s stored — did you get the
          meaning right?
        </div>
      </div>
      <div className="flex gap-2">
        <button
          className="btn flex-1"
          style={{ borderColor: "var(--bad)", color: "var(--bad)" }}
          onClick={() => onChoose("incorrect")}
        >
          No, I was wrong
        </button>
        <button className="btn btn-primary flex-1" onClick={() => onChoose("correct")}>
          Yes, I was right
        </button>
      </div>
    </div>
  );
}

/* ─────────────────────────  Feedback  ───────────────────────── */

function Feedback({
  cur,
  answer,
  result,
  score,
  stageChange,
  onNext,
}: {
  cur: Current;
  answer: string;
  result: Result | null;
  score: Score | null;
  stageChange: { from: Stage; to: Stage } | null;
  onNext: () => void;
}) {
  const promoted =
    stageChange && STAGE_ORDER.indexOf(stageChange.to) > STAGE_ORDER.indexOf(stageChange.from);
  const color = result ? RESULT_VAR[result] : "var(--muted)";
  const heading =
    result === "correct" ? "Correct" : result === "partial" ? "Almost" : "Not quite";

  return (
    <div className="space-y-4">
      <div
        className="rounded-xl p-3"
        style={{
          background:
            result === "correct"
              ? "var(--good-soft)"
              : result === "partial"
                ? "var(--warn-soft)"
                : "var(--bad-soft)",
        }}
      >
        <div className="flex items-center justify-between">
          <span className="font-bold" style={{ color }}>
            {heading}
            {score ? ` · ${score.score}/100` : ""}
          </span>
          {stageChange && (
            <span className="text-sm font-semibold" style={{ color: promoted ? "var(--good)" : "var(--warn)" }}>
              {STAGE_LABEL[stageChange.from]} {promoted ? "▲" : "▼"} {STAGE_LABEL[stageChange.to]}
            </span>
          )}
        </div>

        {/* correct target for locally-graded */}
        {!score && result !== "correct" && (
          <div className="mt-1 text-sm">
            {cur.exerciseType === "flashcard" && cur.flashDir === "en2vn" ? (
              <>Meaning: <b>{cur.word.vi_meaning}</b></>
            ) : (
              <>
                Answer:{" "}
                <b>
                  {cur.exerciseType === "cloze" && cur.generated.answer
                    ? cur.generated.answer
                    : cur.word.word}
                </b>
              </>
            )}
          </div>
        )}

        {/* LLM feedback */}
        {score && (
          <div className="mt-2 space-y-1 text-sm">
            {score.reason && <div>{score.reason}</div>}
            {score.correction && (
              <div>
                <span className="muted">Better: </span>“{score.correction}”
              </div>
            )}
            {score.naturalness_note && (
              <div className="muted">{score.naturalness_note}</div>
            )}
          </div>
        )}
      </div>

      {/* learning context */}
      <div className="text-sm space-y-1">
        <div>
          <b>{cur.word.word}</b>
          {cur.word.ipa && <span className="muted"> {cur.word.ipa}</span>} —{" "}
          {cur.word.vi_meaning}
        </div>
        {cur.word.example_complex && (
          <div className="muted italic">“{cur.word.example_complex}”</div>
        )}
        {cur.word.collocations.length > 0 && (
          <div className="pt-1">
            <span className="muted">Collocations: </span>
            <span className="flex flex-wrap gap-1.5 mt-1">
              {cur.word.collocations.map((c) => (
                <span key={c} className="chip">{c}</span>
              ))}
            </span>
          </div>
        )}
        {cur.word.false_friend_note && (
          <div style={{ color: "var(--warn)" }}>⚠ {cur.word.false_friend_note}</div>
        )}
      </div>

      <button className="btn btn-primary w-full" onClick={onNext} autoFocus>
        Next →
      </button>
    </div>
  );
}
