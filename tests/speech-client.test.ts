import { describe, it, expect, afterEach, vi } from "vitest";
import {
  pickRecorderMimeType,
  micErrorMessage,
  getSilentWavUrl,
  encodeWav,
} from "@/lib/speech/client";
import { parseWav } from "@/lib/speech/wav";

/*
 * Regression tests for the mobile-compatibility seam of pronunciation practice
 * (the "hear it on mobile" / "say it on mobile" fixes). These are the pure,
 * browser-agnostic helpers the React component leans on; the DOM-heavy playback
 * priming is exercised implicitly through them (getSilentWavUrl) plus manual
 * device testing noted in docs/features/pronunciation.md.
 */

/** Install a fake MediaRecorder with a controllable isTypeSupported. */
function stubMediaRecorder(supported: string[] | null) {
  if (supported === null) {
    vi.stubGlobal("MediaRecorder", undefined);
    return;
  }
  const fake = function () {} as unknown as {
    isTypeSupported?: (t: string) => boolean;
  };
  fake.isTypeSupported = (t: string) => supported.includes(t);
  vi.stubGlobal("MediaRecorder", fake);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("pickRecorderMimeType", () => {
  it("returns undefined when MediaRecorder is unavailable (let the browser decide)", () => {
    stubMediaRecorder(null);
    expect(pickRecorderMimeType()).toBeUndefined();
  });

  it("returns undefined when isTypeSupported is missing", () => {
    vi.stubGlobal("MediaRecorder", function () {});
    expect(pickRecorderMimeType()).toBeUndefined();
  });

  it("prefers webm/opus when supported (desktop Chrome)", () => {
    stubMediaRecorder(["audio/webm;codecs=opus", "audio/webm"]);
    expect(pickRecorderMimeType()).toBe("audio/webm;codecs=opus");
  });

  it("falls back to audio/mp4 when webm is unsupported (mobile Chrome / iOS)", () => {
    // The exact class of device this fix targets: no webm support at all.
    stubMediaRecorder(["audio/mp4;codecs=mp4a.40.2", "audio/mp4"]);
    expect(pickRecorderMimeType()).toBe("audio/mp4;codecs=mp4a.40.2");
  });

  it("returns undefined when none of the candidates are supported", () => {
    stubMediaRecorder([]);
    expect(pickRecorderMimeType()).toBeUndefined();
  });
});

describe("micErrorMessage", () => {
  const named = (name: string) => Object.assign(new Error("x"), { name });

  it("maps a permission denial to the blocked message with how-to-fix", () => {
    const msg = micErrorMessage(named("NotAllowedError"));
    expect(msg).toMatch(/blocked/i);
    expect(msg).toMatch(/allow the microphone/i);
  });

  it("treats SecurityError as blocked too", () => {
    expect(micErrorMessage(named("SecurityError"))).toMatch(/blocked/i);
  });

  it("distinguishes a missing device from a permission block", () => {
    expect(micErrorMessage(named("NotFoundError"))).toMatch(/no microphone/i);
  });

  it("distinguishes a mic held by another app", () => {
    expect(micErrorMessage(named("NotReadableError"))).toMatch(/in use by another app/i);
  });

  it("does NOT call an unsupported browser a permission block (the mislabel bug)", () => {
    const msg = micErrorMessage(named("NotSupportedError"));
    expect(msg).not.toMatch(/blocked/i);
    expect(msg).toMatch(/can’t record/i);
  });

  it("has a truthful generic fallback for unknown errors", () => {
    const msg = micErrorMessage(named("WeirdError"));
    expect(msg).toMatch(/couldn’t start recording/i);
  });
});

describe("getSilentWavUrl (mobile autoplay unlock clip)", () => {
  it("is a valid, silent, parseable WAV data URL", () => {
    const url = getSilentWavUrl();
    expect(url.startsWith("data:audio/wav;base64,")).toBe(true);
    const bytes = Buffer.from(url.split(",")[1], "base64");
    const info = parseWav(new Uint8Array(bytes));
    expect(info).not.toBeNull();
    expect(info!.channels).toBe(1);
    expect(info!.sampleRate).toBe(16000);
    expect(info!.seconds).toBeGreaterThan(0);
  });

  it("memoizes to a stable URL across calls", () => {
    expect(getSilentWavUrl()).toBe(getSilentWavUrl());
  });
});

describe("encodeWav", () => {
  it("produces a header the server WAV parser accepts", () => {
    const wav = encodeWav(new Float32Array(8000), 16000); // 0.5s silence
    const info = parseWav(new Uint8Array(wav));
    expect(info).not.toBeNull();
    expect(info!.bitsPerSample).toBe(16);
    expect(info!.dataBytes).toBe(8000 * 2);
  });
});
