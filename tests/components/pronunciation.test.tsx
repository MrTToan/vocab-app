import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { mockFetch, renderWithSWR } from "./harness";
import PronunciationPractice, {
  ResultCard,
  type AssessResult,
} from "@/components/practice/PronunciationPractice";

/*
 * Client-side gating for the pronunciation controls. The mic ("Say it") button
 * depends on browser MediaRecorder/getUserMedia, which jsdom lacks — so this
 * environment doubles as the "no mic API" case: the control must degrade to
 * hear-it only, never crash. And when config says speech is unavailable the whole
 * control renders nothing.
 */

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("PronunciationPractice", () => {
  it("renders nothing when no speech provider is available", async () => {
    mockFetch({ "GET /api/config": { hasLLM: true, owner: false, speech: { tts: false, assess: false } } });
    const { container } = renderWithSWR(<PronunciationPractice word="reluctant" />);
    // Give SWR a tick to resolve, then assert still empty.
    await waitFor(() => {
      expect(container.querySelector("button")).toBeNull();
    });
  });

  it("shows Hear it when TTS is available", async () => {
    mockFetch({ "GET /api/config": { hasLLM: true, owner: false, speech: { tts: true, assess: true } } });
    renderWithSWR(<PronunciationPractice word="reluctant" example="She was reluctant." />);
    expect(await screen.findByRole("button", { name: /hear reluctant/i })).toBeTruthy();
  });

  it("hides Say it when the browser can't record (no MediaRecorder), keeping Hear it", async () => {
    mockFetch({ "GET /api/config": { hasLLM: true, owner: false, speech: { tts: true, assess: true } } });
    renderWithSWR(<PronunciationPractice word="reluctant" />);
    await screen.findByRole("button", { name: /hear reluctant/i });
    // jsdom has no MediaRecorder → the record button must not be present.
    expect(screen.queryByRole("button", { name: /record yourself/i })).toBeNull();
  });

  it("primes the audio element inside the tap before the fetched clip plays (mobile gesture-safe)", async () => {
    // Regression for the mobile "Hear it → Couldn't play that right now." bug:
    // mobile browsers only allow play() on a user-activated element, so the tap
    // handler must play a silent clip FIRST (in the gesture) and only then play
    // the fetched TTS — i.e. play() is called twice, silent src first.
    mockFetch({
      "GET /api/config": { hasLLM: true, owner: false, speech: { tts: true, assess: false } },
      "POST /api/speech/tts": { ok: true },
    });
    const playedSrcs: string[] = [];
    const playSpy = vi
      .spyOn(HTMLMediaElement.prototype, "play")
      .mockImplementation(function (this: HTMLMediaElement) {
        playedSrcs.push(this.src);
        return Promise.resolve();
      });
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: () => "blob:mock",
      revokeObjectURL: () => {},
    });

    renderWithSWR(<PronunciationPractice word="reluctant" example="She was reluctant." />);
    const btn = await screen.findByRole("button", { name: /hear reluctant/i });
    fireEvent.click(btn);

    await waitFor(() => expect(playSpy).toHaveBeenCalledTimes(2));
    // First play is the silent priming clip (a data: URL), inside the gesture…
    expect(playedSrcs[0]).toMatch(/^data:audio\/wav/);
    // …the second is the fetched TTS blob URL, after the (now-unlocked) element.
    expect(playedSrcs[1]).toBe("blob:mock");
    playSpy.mockRestore();
  });
});

/*
 * "Say sentence" (the cloze exercise). jsdom lacks MediaRecorder/getUserMedia and
 * the WebAudio WAV encoder, so we install minimal stubs to drive the record→stop→
 * POST flow and assert the request carries mode:"sentence" + the completed sentence
 * as the reference. The single-word "Say it" path stays untouched.
 */
vi.mock("@/lib/speech/client", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/speech/client")>();
  return { ...real, blobToWavDataUrl: async () => "data:audio/wav;base64,AAAA" };
});

function installMicStubs() {
  const track = { stop: vi.fn() };
  vi.stubGlobal("navigator", {
    ...navigator,
    mediaDevices: { getUserMedia: vi.fn(async () => ({ getTracks: () => [track] })) },
  });
  class FakeMediaRecorder {
    static isTypeSupported = () => true;
    ondataavailable: ((e: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    mimeType = "audio/webm";
    stream = { getTracks: () => [track] };
    start() {}
    stop() {
      this.ondataavailable?.({ data: new Blob(["x"], { type: "audio/webm" }) });
      this.onstop?.();
    }
  }
  vi.stubGlobal("MediaRecorder", FakeMediaRecorder as unknown as typeof MediaRecorder);
}

describe("PronunciationPractice — Say sentence (cloze)", () => {
  it("does not show Say sentence when no sentence is provided", async () => {
    installMicStubs();
    mockFetch({ "GET /api/config": { hasLLM: true, owner: false, speech: { tts: true, assess: true } } });
    renderWithSWR(<PronunciationPractice word="reluctant" />);
    await screen.findByRole("button", { name: /record yourself saying reluctant/i });
    expect(screen.queryByRole("button", { name: /whole sentence/i })).toBeNull();
  });

  it("shows Say sentence when a sentence is provided", async () => {
    installMicStubs();
    mockFetch({ "GET /api/config": { hasLLM: true, owner: false, speech: { tts: true, assess: true } } });
    renderWithSWR(
      <PronunciationPractice word="reluctant" sentence="She was reluctant to leave." />,
    );
    expect(await screen.findByRole("button", { name: /whole sentence/i })).toBeTruthy();
  });

  it("Say sentence POSTs mode:sentence with the completed sentence as reference", async () => {
    installMicStubs();
    const sentence = "She was reluctant to leave.";
    const fetchMock = mockFetch({
      "GET /api/config": { hasLLM: true, owner: false, speech: { tts: true, assess: true } },
      "POST /api/speech/assess": {
        provider: "azure",
        score: 88,
        verdict: "good",
        transcript: sentence,
        reference: sentence,
        feedback: "Nice.",
        method: "phoneme",
        detail: { accuracy: 88, fluency: 90, completeness: 100 },
      },
    });
    renderWithSWR(<PronunciationPractice word="reluctant" sentence={sentence} />);
    const btn = await screen.findByRole("button", { name: /whole sentence/i });
    fireEvent.click(btn); // start → our fake recorder is live
    // The button flips to Stop; clicking it stops → fires onstop → POST.
    const stop = await screen.findByRole("button", { name: /whole sentence/i });
    fireEvent.click(stop);

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        (c) => String(c[0]).includes("/api/speech/assess"),
      );
      expect(call).toBeTruthy();
      const body = JSON.parse((call![1] as RequestInit).body as string);
      expect(body.mode).toBe("sentence");
      expect(body.reference).toBe(sentence);
      expect(body.word).toBe("reluctant");
    });
  });
});

describe("PronunciationPractice — ResultCard verdict rendering", () => {
  const base: AssessResult = {
    provider: "azure",
    score: 0,
    verdict: "good",
    transcript: "",
    reference: "reluctant",
    feedback: "",
    method: "phoneme",
    detail: null,
  };

  it("shows a real Azure score for a graded attempt (regression: not blank/0)", () => {
    render(
      <ResultCard
        result={{ ...base, verdict: "good", score: 92, feedback: "Excellent!", detail: { accuracy: 92, fluency: 100, completeness: 100 } }}
      />,
    );
    expect(screen.getByText(/92\/100/)).toBeTruthy();
    expect(screen.getByText(/✓ Good/)).toBeTruthy();
  });

  it("renders 'unclear' honestly — a neutral 'didn't catch that', with NO 0/100", () => {
    render(
      <ResultCard
        result={{ ...base, verdict: "unclear", score: 0, feedback: "I couldn't quite catch that — check your mic…" }}
      />,
    );
    // The whole point: an unrecognized clip is NOT shown as a failed 0/100.
    expect(screen.queryByText(/\/100/)).toBeNull();
    expect(screen.queryByText(/needs work/i)).toBeNull();
    expect(screen.getByText(/didn’t catch that/i)).toBeTruthy();
  });
});
