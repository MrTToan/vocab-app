/*
 * Browser-side speech helpers for the pronunciation practice UI.
 *
 * These are the mobile-compatibility seam for "hear it" / "say it": they are
 * kept out of the React component so they can be unit-tested directly (see
 * tests/speech-client.test.ts). Nothing here touches a provider key — the
 * client only ever encodes the mic recording to WAV and picks a recordable
 * container; all provider calls stay server-side.
 */

/* ── MediaRecorder container selection ───────────────────────────────────
 *
 * Desktop and mobile Chrome support DIFFERENT audio containers. Desktop Chrome
 * records `audio/webm;codecs=opus` by default; some mobile Chrome/WebView and
 * iOS Safari builds do NOT support webm and instead need `audio/mp4`. Passing
 * an unsupported `mimeType` to `new MediaRecorder(...)` throws (a
 * NotSupportedError), which the old code surfaced as "can't record" — so feature
 * -detect a container the browser actually supports and let it fall back to the
 * browser default (return undefined) when none of our candidates match.
 */
const RECORDER_MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4;codecs=mp4a.40.2",
  "audio/mp4",
  "audio/ogg;codecs=opus",
  "audio/ogg",
] as const;

export function pickRecorderMimeType(): string | undefined {
  if (
    typeof MediaRecorder === "undefined" ||
    typeof MediaRecorder.isTypeSupported !== "function"
  ) {
    return undefined; // let the browser choose its own default
  }
  return RECORDER_MIME_CANDIDATES.find((t) => MediaRecorder.isTypeSupported(t));
}

/* ── Honest getUserMedia error messages ──────────────────────────────────
 *
 * The old code regex-matched the error text and collapsed everything that
 * wasn't obviously "denied" into "no microphone found", so a browser that
 * genuinely can't record here, or a mic held by another app, was mislabeled.
 * Classify by the DOMException `name` (stable across browsers) and give a
 * distinct, actionable line for each real case.
 */
export function micErrorMessage(err: unknown): string {
  const name = err instanceof Error ? err.name : "";
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return "Microphone access was blocked. Tap the lock/site-info icon in your browser’s address bar, allow the microphone, then try “Say it” again.";
    case "NotFoundError":
    case "OverconstrainedError":
      return "No microphone found. Check your device and try again.";
    case "NotReadableError":
    case "AbortError":
      return "Your microphone is in use by another app. Close it and try again.";
    case "NotSupportedError":
      return "This browser can’t record audio here. Open Lexi directly in Chrome or Safari (not inside another app’s browser) and try again.";
    default:
      return "Couldn’t start recording. Please try again.";
  }
}

/* ── WAV encoding (unchanged behaviour, moved here for testability) ─────── */

/**
 * Decode the recorded blob and re-encode it as a 16 kHz mono 16-bit PCM WAV data
 * URL — the format both server providers accept, so the server never transcodes.
 */
export async function blobToWavDataUrl(blob: Blob): Promise<string> {
  const arrayBuf = await blob.arrayBuffer();
  const AudioCtx: typeof AudioContext =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
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
export function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
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
export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

/* ── Silent-clip "unlock" for mobile autoplay ────────────────────────────
 *
 * Mobile Chrome/iOS only allow programmatic <audio>.play() on an element the
 * user has already activated. "Hear it" fetches the TTS bytes (async) and then
 * plays them, so by the time play() runs the tap gesture is gone and it rejects.
 * Priming the element with a tiny silent clip DURING the tap activates it, so
 * the later play() is allowed. Built lazily in the browser (btoa is browser-only;
 * this module is also imported during SSR).
 */
let silentWavUrl: string | null = null;
export function getSilentWavUrl(): string {
  if (silentWavUrl) return silentWavUrl;
  const wav = encodeWav(new Float32Array(1600), 16000); // ~0.1s of silence
  silentWavUrl = `data:audio/wav;base64,${bytesToBase64(new Uint8Array(wav))}`;
  return silentWavUrl;
}
