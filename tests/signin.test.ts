import { describe, it, expect } from "vitest";
import { safeCallbackPath, signInBouncePath, signInHref } from "@/lib/signin";

/*
 * Landing sign-in hand-off (landing-audit finding 1): signed-out CTAs go straight
 * to Auth.js sign-in with a same-origin callback, and the proxy bounce carries the
 * requested deep link back so the notice's button returns there.
 */
describe("signin helpers", () => {
  it("builds the Auth.js sign-in URL with an encoded callback", () => {
    expect(signInHref("/vocab")).toBe("/api/auth/signin?callbackUrl=%2Fvocab");
    expect(signInHref("/writing")).toBe("/api/auth/signin?callbackUrl=%2Fwriting");
    expect(signInHref("/practice?w=1&x=2")).toBe(
      "/api/auth/signin?callbackUrl=%2Fpractice%3Fw%3D1%26x%3D2",
    );
  });

  it("falls back to /vocab for missing or unsafe callbacks", () => {
    for (const bad of [null, undefined, "", "vocab", "//evil.com", "/\\evil.com", "https://evil.com", "javascript:alert(1)", "/a\nb"]) {
      expect(safeCallbackPath(bad)).toBeNull();
      expect(signInHref(bad)).toBe("/api/auth/signin?callbackUrl=%2Fvocab");
    }
  });

  it("bounce path keeps the requested page (or degrades to plain ?signin=1)", () => {
    expect(signInBouncePath("/writing/task1?id=3")).toBe(
      "/?signin=1&next=%2Fwriting%2Ftask1%3Fid%3D3",
    );
    expect(signInBouncePath("//evil.com")).toBe("/?signin=1");
  });
});
