import { Fraunces, IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";

/*
 * Type system — an academic-but-warm pairing, deliberately not the system-font
 * default:
 *  · Fraunces  → literary display serif for headings/hero (words, language, reading)
 *  · IBM Plex Sans → precise, legible body/UI
 *  · IBM Plex Mono → data, timers, word counts ("the graded numbers")
 *
 * PERF: these load from app/(app)/layout.tsx (and the legal pages, which reuse
 * the body face) instead of the root layout, so the marketing pages — which
 * bring their own Cormorant/Inter — never download them. Fraunces and IBM Plex
 * Sans are VARIABLE Google fonts: one file per style covers every weight
 * (next/font: omit `weight`, or pass a range, for variable families — see
 * node_modules/next/dist/docs/.../font.md), so the app ships 4 font files
 * total instead of 15.
 *
 * The wrapper that carries these `.variable` classes must also carry the
 * `app-fonts` class from globals.css: `body`'s own font-family rule cannot see
 * CSS variables defined on a descendant, so the family is re-applied there.
 */
export const display = Fraunces({
  subsets: ["latin"],
  variable: "--font-display",
  // Variable font — one file covers the whole wght axis (next/font/google's
  // types accept no range here, only "variable"/discrete weights). NOTE: this
  // means `font-extrabold` headings now get a true 800 instead of the 700 the
  // old static set clamped them to — a hair bolder, same face.
  display: "swap",
});

export const body = IBM_Plex_Sans({
  subsets: ["latin"],
  variable: "--font-body",
  // Variable font — full wght range (100–700); no `weight` needed.
  display: "swap",
});

export const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  // Not a variable family. 400 = code/inputs; 600 = the closest match the
  // `font-extrabold tabular-nums` stat tiles were already resolving to.
  weight: ["400", "600"],
  display: "swap",
});
