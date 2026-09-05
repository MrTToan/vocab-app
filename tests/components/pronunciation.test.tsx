import { describe, it, expect, afterEach, vi } from "vitest";
import { screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { mockFetch, renderWithSWR } from "./harness";
import PronunciationPractice from "@/components/practice/PronunciationPractice";

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
