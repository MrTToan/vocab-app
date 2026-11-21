import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { mockFetch } from "./harness";

/*
 * Landing-audit finding 1: every landing CTA dead-ended for a signed-out visitor
 * (proxy bounced /vocab → /?signin=1, the same page). <AppLink> must send a
 * signed-out visitor straight to Auth.js sign-in with the right callback, keep
 * signed-in visitors (and the no-auth dev seam) on the direct route, and the
 * ?signin=1 notice must offer a real Continue-with-Google button.
 */

let search = new URLSearchParams();
vi.mock("next/navigation", () => ({ useSearchParams: () => search }));

import AppLink from "@/app/(marketing)/AppLink";
import SignInNote from "@/app/(marketing)/SignInNote";
import { __resetSignedOutCache } from "@/app/(marketing)/useSignedOut";

beforeEach(() => {
  __resetSignedOutCache();
  search = new URLSearchParams();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AppLink", () => {
  it("signed out → straight to Google sign-in with callback to the destination", async () => {
    mockFetch({ "GET /api/auth/session": null });
    render(
      <>
        <AppLink to="/vocab">Open app</AppLink>
        <AppLink to="/writing">Score my IELTS writing</AppLink>
      </>,
    );
    await waitFor(() =>
      expect(screen.getByText("Open app").getAttribute("href")).toBe(
        "/api/auth/signin?callbackUrl=%2Fvocab",
      ),
    );
    expect(screen.getByText("Score my IELTS writing").getAttribute("href")).toBe(
      "/api/auth/signin?callbackUrl=%2Fwriting",
    );
  });

  it("signed in → direct link to the destination", async () => {
    const f = mockFetch({ "GET /api/auth/session": { user: { name: "A" } } });
    render(<AppLink to="/vocab">Open app</AppLink>);
    await waitFor(() => expect(f).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.getByText("Open app").getAttribute("href")).toBe("/vocab");
  });

  it("auth unconfigured / session endpoint errors → fails open to the direct link", async () => {
    const f = mockFetch({ "GET /api/auth/session": { status: 500, body: {} } });
    render(<AppLink to="/writing">Writing</AppLink>);
    await waitFor(() => expect(f).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.getByText("Writing").getAttribute("href")).toBe("/writing");
  });
});

describe("SignInNote (?signin=1)", () => {
  it("renders nothing without ?signin=1", () => {
    const { container } = render(<SignInNote />);
    expect(container.innerHTML).toBe("");
  });

  it("shows a Continue with Google button returning to the bounced page", () => {
    search = new URLSearchParams("signin=1&next=%2Fwriting%2Ftask1");
    render(<SignInNote />);
    expect(screen.getByText(/sign in to continue/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: /continue with google/i }).getAttribute("href")).toBe(
      "/api/auth/signin?callbackUrl=%2Fwriting%2Ftask1",
    );
  });

  it("ignores an off-site ?next= and falls back to /vocab", () => {
    search = new URLSearchParams("signin=1&next=%2F%2Fevil.com");
    render(<SignInNote />);
    expect(screen.getByRole("link", { name: /continue with google/i }).getAttribute("href")).toBe(
      "/api/auth/signin?callbackUrl=%2Fvocab",
    );
  });
});
