import { describe, it, expect } from "vitest";
import { parseWav } from "@/lib/speech/wav";
import { parseAssessment } from "@/lib/speech/azure";

/** Build a minimal 16 kHz mono 16-bit PCM WAV with `frames` samples of silence. */
function makeWav(frames: number, sampleRate = 16000): Uint8Array {
  const dataLen = frames * 2;
  const buf = new ArrayBuffer(44 + dataLen);
  const v = new DataView(buf);
  const s = (o: number, str: string) => {
    for (let i = 0; i < str.length; i++) v.setUint8(o + i, str.charCodeAt(i));
  };
  s(0, "RIFF");
  v.setUint32(4, 36 + dataLen, true);
  s(8, "WAVE");
  s(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  s(36, "data");
  v.setUint32(40, dataLen, true);
  return new Uint8Array(buf);
}

describe("parseWav", () => {
  it("reads format + duration from a valid WAV", () => {
    const info = parseWav(makeWav(16000)); // 1 second
    expect(info).not.toBeNull();
    expect(info!.sampleRate).toBe(16000);
    expect(info!.channels).toBe(1);
    expect(info!.bitsPerSample).toBe(16);
    expect(info!.seconds).toBeCloseTo(1, 3);
  });
  it("rejects non-WAV bytes", () => {
    expect(parseWav(new Uint8Array([0, 1, 2, 3]))).toBeNull();
    expect(parseWav(new Uint8Array(50))).toBeNull(); // right length, no RIFF/WAVE
  });
  it("computes a short clip's seconds", () => {
    expect(parseWav(makeWav(1600))!.seconds).toBeCloseTo(0.1, 3);
  });
});

describe("parseAssessment (Azure response → scores)", () => {
  it("pulls PronScore + component scores from NBest", () => {
    const r = parseAssessment({
      RecognitionStatus: "Success",
      DisplayText: "reluctant",
      NBest: [
        {
          Display: "reluctant",
          PronunciationAssessment: {
            AccuracyScore: 88,
            FluencyScore: 92,
            CompletenessScore: 100,
            PronScore: 90,
          },
        },
      ],
    });
    expect(r.score).toBe(90);
    expect(r.detail).toEqual({ accuracy: 88, fluency: 92, completeness: 100 });
    expect(r.transcript).toBe("reluctant");
  });
  it("falls back to accuracy when PronScore is absent, and 0s on NoMatch", () => {
    expect(
      parseAssessment({ NBest: [{ PronunciationAssessment: { AccuracyScore: 55 } }] }).score,
    ).toBe(55);
    const none = parseAssessment({ RecognitionStatus: "NoMatch", NBest: [] });
    expect(none.score).toBe(0);
    expect(none.detail).toEqual({ accuracy: 0, fluency: 0, completeness: 0 });
  });
});
