import { describe, it, expect, afterEach, vi } from "vitest";
import { screen, waitFor, cleanup } from "@testing-library/react";
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
});
