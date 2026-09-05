import { describe, it, expect } from "vitest";
import nextConfig from "../next.config";

/*
 * Regression guard for the pronunciation-in-production outage (#68/#69 shipped
 * the feature but it failed on EVERY device against the live headers, masked by
 * a dev server that doesn't send them).
 *
 * Two response headers in next.config.ts silently broke the two controls:
 *
 *   1. CSP had no `media-src`, so <audio> fell back to `default-src 'self'`,
 *      which blocks the `blob:` TTS audio and the `data:` silent-prime clip that
 *      "Hear it" plays → MediaError code 4 → "Couldn't play that right now."
 *   2. `Permissions-Policy: microphone=()` disabled the mic for the origin, so
 *      "Say it"'s getUserMedia({audio:true}) rejected NotAllowedError with no
 *      prompt (and the site-info "allow" toggle couldn't override it).
 *
 * Both were reproduced live at https://lexi.vnfriends.com/ in a real browser:
 * the CSP `media-src` violation fired for both `data` and `blob`, and
 * `document.featurePolicy.allowsFeature('microphone')` was `false`. These
 * assertions pin the fix so the headers can't silently regress the feature again.
 */

async function securityHeaders(): Promise<Record<string, string>> {
  const groups = await nextConfig.headers!();
  const flat: Record<string, string> = {};
  for (const g of groups) {
    for (const h of g.headers) flat[h.key.toLowerCase()] = h.value;
  }
  return flat;
}

describe("production security headers keep pronunciation working", () => {
  it("CSP media-src allows the blob: TTS audio and data: prime clip", async () => {
    const csp = (await securityHeaders())["content-security-policy"];
    expect(csp, "CSP header must be present").toBeTruthy();

    // A media-src directive must exist (else <audio> falls back to default-src
    // 'self', which blocks blob:/data: and breaks "Hear it").
    const media = csp
      .split(";")
      .map((d) => d.trim())
      .find((d) => d.startsWith("media-src "));
    expect(media, "CSP must declare an explicit media-src").toBeTruthy();
    expect(media).toContain("blob:"); // URL.createObjectURL(TTS bytes)
    expect(media).toContain("data:"); // getSilentWavUrl() prime clip
  });

  it("Permissions-Policy allows the microphone for our own origin (self)", async () => {
    const pp = (await securityHeaders())["permissions-policy"];
    expect(pp, "Permissions-Policy header must be present").toBeTruthy();

    // "Say it" needs getUserMedia on our origin: microphone must allow self and
    // must NOT be the empty allowlist that blocks every origin.
    expect(pp).toMatch(/microphone=\(self\)/);
    expect(pp).not.toMatch(/microphone=\(\)/);

    // Unused capabilities stay fully disabled — the fix is scoped to the mic.
    expect(pp).toMatch(/camera=\(\)/);
    expect(pp).toMatch(/geolocation=\(\)/);
  });
});
