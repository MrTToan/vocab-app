"use client";

/*
 * Two-way pronunciation practice, shown in the practice reveal for the word the
 * learner just studied.
 *
 *   🔊 Hear it  → POST /api/speech/tts, plays the returned audio.
 *   🎤 Say it   → records the mic, encodes a 16 kHz mono WAV, POSTs it to
 *                 /api/speech/assess, and shows a score / verdict + a line.
 *
 * Both provider calls are server-side (keys never reach the browser). The whole
 * control hides itself when no speech provider is available (config.speech), and
 * degrades gracefully when the browser lacks mic APIs or the user denies the
 * mic — never a hard crash. The WAV format is chosen so the server needs no
 * transcoder (Azure Pronunciation Assessment + OpenAI Whisper both accept it).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useConfig } from "@/lib/swr";

interface AssessResult {
  provider: "azure" | "openai";
  score: number | null;
  verdict: "good" | "needs-work";
  transcript: string;
  reference: string;
  feedback: string;
  method: "phoneme" | "word-match";
  detail: { accuracy: number; fluency: number; completeness: number } | null;
}

type SayState = "idle" | "recording" | "checking";

const MAX_RECORD_MS = 5000;

export default function PronunciationPractice({
  word,
  example,
}: {
  word: string;
  example?: string;
}) {
  const { data: config } = useConfig();
  const speech = config?.speech;

  const [playing, setPlaying] = useState(false);
  const [sayState, setSayState] = useState<SayState>("idle");
  const [result, setResult] = useState<AssessResult | null>(null);
  const [note, setNote] = useState<string>(""); // errors / hints

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Whether the browser can record at all (SSR-safe: computed after mount).
  const [canRecord, setCanRecord] = useState(false);
  useEffect(() => {
    setCanRecord(
      typeof navigator !== "undefined" &&
        !!navigator.mediaDevices?.getUserMedia &&
        typeof window !== "undefined" &&
        typeof window.MediaRecorder !== "undefined",
    );
  }, []);

  // Reset transient state whenever the word changes (new reveal).
  useEffect(() => {
    setResult(null);
    setNote("");
    setSayState("idle");
  }, [word]);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
      try {
        recRef.current?.stream.getTracks().forEach((t) => t.stop());
      } catch {
        /* ignore */
      }
    };
  }, []);

  /* ── hear it ──────────────────────────────────────────────────────── */
  const hearIt = useCallback(async () => {
    if (playing) return;
    setNote("");
    setPlaying(true);
    try {
      const res = await fetch("/api/speech/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ word, example }),
      });
      if (!res.ok) {
        const msg = await errText(res, "Couldn't play that right now.");
        setNote(msg);
        setPlaying(false);
        return;
      }
      const blob = await res.blob();
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
      const url = URL.createObjectURL(blob);
      audioUrlRef.current = url;
      const el = audioRef.current ?? new Audio();
      audioRef.current = el;
      el.src = url;
      el.onended = () => setPlaying(false);
      el.onerror = () => {
        setNote("Couldn't play that right now.");
        setPlaying(false);
      };
      await el.play();
    } catch {
      setNote("Couldn't play that right now.");
      setPlaying(false);
    }
  }, [playing, word, example]);

  /* ── say it ───────────────────────────────────────────────────────── */
  const stopRecording = useCallback(() => {
    if (stopTimerRef.current) {
      clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
    }
    try {
      recRef.current?.stop(); // fires onstop → upload
    } catch {
      /* ignore */
    }
  }, []);

  const startRecording = useCallback(async () => {
    setNote("");
    setResult(null);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      const denied = err instanceof Error && /not\s?allowed|denied|permission/i.test(err.name + err.message);
      setNote(
        denied
          ? "Microphone access was blocked. Allow the mic in your browser to try “Say it”."
          : "No microphone found. Check your device and try again.",
      );
      return;
    }
    const chunks: Blob[] = [];
    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(stream);
    } catch {
      stream.getTracks().forEach((t) => t.stop());
      setNote("This browser can't record audio for pronunciation.");
      return;
    }
    recRef.current = rec;
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    rec.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      setSayState("checking");
      try {
        const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" });
        const dataUrl = await blobToWavDataUrl(blob);
        const res = await fetch("/api/speech/assess", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ word, audio: dataUrl }),
        });
        if (!res.ok) {
          setNote(await errText(res, "Couldn't check that right now."));
          setSayState("idle");
          return;
        }
        setResult((await res.json()) as AssessResult);
        setSayState("idle");
      } catch {
        setNote("Couldn't process the recording. Please try again.");
        setSayState("idle");
      }
    };
    rec.start();
    setSayState("recording");
    stopTimerRef.current = setTimeout(stopRecording, MAX_RECORD_MS);
  }, [word, stopRecording]);

  // Nothing usable → render nothing (graceful hide).
  if (!speech || (!speech.tts && !speech.assess)) return null;

  return (
    <div className="pt-1 space-y-2">
      <div className="flex flex-wrap gap-2 items-center">
        {speech.tts && (
          <button
            type="button"
            className="btn"
            onClick={hearIt}
            disabled={playing}
            aria-label={`Hear ${word} pronounced`}
          >
            {playing ? "🔊 Playing…" : "🔊 Hear it"}
          </button>
        )}
        {speech.assess && canRecord && (
          <button
            type="button"
            className="btn"
            onClick={sayState === "recording" ? stopRecording : startRecording}
            disabled={sayState === "checking"}
            aria-label={`Record yourself saying ${word}`}
          >
            {sayState === "recording"
              ? "⏹ Stop"
              : sayState === "checking"
                ? "⏳ Checking…"
                : "🎤 Say it"}
          </button>
        )}
        {sayState === "recording" && (
          <span className="muted text-xs" style={{ color: "var(--warn)" }}>
            ● Recording — say “{word}”
          </span>
        )}
      </div>

      {note && (
        <div className="text-xs muted" role="status">
          {note}
        </div>
      )}

      {result && <ResultCard result={result} />}
    </div>
  );
}

function ResultCard({ result }: { result: AssessResult }) {
  const good = result.verdict === "good";
  return (
    <div
      className="text-sm rounded-md px-3 py-2"
      role="status"
      style={{
        background: "var(--surface, rgba(0,0,0,0.03))",
        border: `1px solid ${good ? "var(--ok, #16a34a)" : "var(--warn, #d97706)"}`,
      }}
    >
      <div className="font-semibold" style={{ color: good ? "var(--ok, #16a34a)" : "var(--warn, #d97706)" }}>
        {good ? "✓ Good" : "○ Needs work"}
        {typeof result.score === "number" && <span className="muted font-normal"> · {result.score}/100</span>}
      </div>
      <div className="mt-1">{result.feedback}</div>
      {result.detail && (
        <div className="muted text-xs mt-1">
          Accuracy {Math.round(result.detail.accuracy)} · Fluency {Math.round(result.detail.fluency)} ·
          Completeness {Math.round(result.detail.completeness)}
        </div>
      )}
      {result.method === "word-match" && (
        <div className="muted text-xs mt-1">Heard as a whole word (not per-sound scoring).</div>
      )}
    </div>
  );
}

/* ── helpers ────────────────────────────────────────────────────────── */

async function errText(res: Response, fallback: string): Promise<string> {
  try {
    const j = (await res.json()) as { error?: string };
    return j.error || fallback;
  } catch {
    return fallback;
  }
}

/**
 * Decode the recorded blob and re-encode it as a 16 kHz mono 16-bit PCM WAV data
 * URL — the format both server providers accept, so the server never transcodes.
 */
async function blobToWavDataUrl(blob: Blob): Promise<string> {
  const arrayBuf = await blob.arrayBuffer();
  const AudioCtx: typeof AudioContext =
    window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AudioCtx();
  let decoded: AudioBuffer;
  try {
    decoded = await ctx.decodeAudioData(arrayBuf);
  } finally {
    ctx.close().catch(() => {});
  }
  const targetRate = 16000;
  const frames = Math.max(1, Math.ceil(decoded.duration * targetRate));
  const offline = new OfflineAudioContext(1, frames, targetRate);
  const src = offline.createBufferSource();
  src.buffer = decoded;
  src.connect(offline.destination);
  src.start();
  const rendered = await offline.startRendering();
  const wav = encodeWav(rendered.getChannelData(0), targetRate);
  return `data:audio/wav;base64,${bytesToBase64(new Uint8Array(wav))}`;
}

/** Float32 [-1,1] PCM → a 16-bit mono WAV ArrayBuffer. */
function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const dataLen = samples.length * 2;
  const buf = new ArrayBuffer(44 + dataLen);
  const view = new DataView(buf);
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataLen, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate (mono, 16-bit)
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeStr(36, "data");
  view.setUint32(40, dataLen, true);
  let off = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    off += 2;
  }
  return buf;
}

/** Chunked base64 (avoids a huge apply() spread on big buffers). */
function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}
