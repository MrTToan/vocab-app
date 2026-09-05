import type { NextConfig } from "next";

/*
 * Security headers applied to every response. The CSP is deliberately tight:
 *  - script-src 'unsafe-inline' is needed for Next's inline hydration/bootstrap
 *    scripts (no nonce plumbing — proxy.ts only does a cookie-presence
 *    sign-in redirect and touches no headers).
 *  - style-src 'unsafe-inline' for Tailwind/React inline styles + next/font.
 *  - img-src allows Google profile pictures (lh3.googleusercontent.com); next/font
 *    and next/image are self-hosted so 'self' covers them.
 *  - media-src 'self' blob: data: — REQUIRED by pronunciation practice
 *    (components/practice/PronunciationPractice.tsx): "Hear it" plays the TTS
 *    audio from a `blob:` object URL and primes a silent `data:` WAV. Without an
 *    explicit media-src, <audio> falls back to default-src 'self', which blocks
 *    both blob: and data: — the element fires `error` (MediaError code 4) and the
 *    UI shows "Couldn't play that right now." on EVERY device (it was masked in
 *    dev, which doesn't send these headers). See tests/security-headers.test.ts.
 *  - form-action allows the Google sign-in redirect; frame-ancestors 'none'
 *    mirrors X-Frame-Options: DENY.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://lh3.googleusercontent.com",
  "media-src 'self' blob: data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self' https://accounts.google.com",
].join("; ");

const SECURITY_HEADERS = [
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // microphone=(self): the "Say it" recorder calls getUserMedia({audio:true}) on
  // our OWN origin. `microphone=()` disables the mic for every origin including
  // self, so getUserMedia rejects with NotAllowedError and NO permission prompt
  // ever appears — the site-info "allow microphone" toggle can't override a
  // Permissions-Policy block, which is why it failed on the captain's phone even
  // after granting. camera/geolocation stay fully disabled (unused). Guard:
  // tests/security-headers.test.ts.
  { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=()" },
  { key: "Content-Security-Policy", value: CSP },
];

const nextConfig: NextConfig = {
  images: {
    // Serve AVIF (then WebP) to browsers that accept them — the marketing
    // box/cover JPEGs shrink to a fraction of their size over the long
    // Vietnam↔Helsinki path. next/image negotiates via the Accept header.
    formats: ["image/avif", "image/webp"],
  },
  async headers() {
    return [{ source: "/(.*)", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
