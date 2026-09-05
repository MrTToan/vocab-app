/*
 * Minimal, pure RIFF/WAVE header parsing.
 *
 * The client records the learner's "say it" audio and encodes it to a 16-bit PCM
 * WAV before upload (16 kHz mono — the format both Azure Pronunciation
 * Assessment and OpenAI Whisper accept, so the server stays transcoder-free).
 * The server uses this to (a) sanity-check the upload really is PCM WAV and
 * (b) derive the clip's duration for the Azure free-tier seconds budget — no
 * trusting a client-sent duration. Unit-tested in tests/speech-wav.test.ts.
 */

export interface WavInfo {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  /** PCM data length in bytes. */
  dataBytes: number;
  /** Clip length in seconds. */
  seconds: number;
}

function ascii(buf: Uint8Array, off: number, len: number): string {
  let s = "";
  for (let i = 0; i < len; i++) s += String.fromCharCode(buf[off + i]);
  return s;
}

/**
 * Parse a WAV byte buffer's format, or null if it isn't a well-formed
 * PCM/IEEE-float RIFF/WAVE file. Walks the chunk list so a "fmt "/"data" pair
 * anywhere after the header is found (some encoders insert a LIST/fact chunk).
 */
export function parseWav(bytes: Uint8Array): WavInfo | null {
  if (bytes.length < 44) return null;
  if (ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WAVE") return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  let channels = 0;
  let sampleRate = 0;
  let bitsPerSample = 0;
  let dataBytes = 0;
  let sawFmt = false;

  let off = 12; // past "RIFF"<size>"WAVE"
  while (off + 8 <= bytes.length) {
    const id = ascii(bytes, off, 4);
    const size = dv.getUint32(off + 4, true);
    const body = off + 8;
    if (id === "fmt " && body + 16 <= bytes.length) {
      channels = dv.getUint16(body + 2, true);
      sampleRate = dv.getUint32(body + 4, true);
      bitsPerSample = dv.getUint16(body + 14, true);
      sawFmt = true;
    } else if (id === "data") {
      // Some streams write 0xFFFFFFFF / an over-long size; clamp to what's here.
      dataBytes = Math.min(size, bytes.length - body);
    }
    // Chunks are word-aligned (padded to even length).
    off = body + size + (size % 2);
  }

  if (!sawFmt || !sampleRate || !channels || !bitsPerSample) return null;
  const bytesPerSec = (sampleRate * channels * bitsPerSample) / 8;
  const seconds = bytesPerSec > 0 ? dataBytes / bytesPerSec : 0;
  return { sampleRate, channels, bitsPerSample, dataBytes, seconds };
}
