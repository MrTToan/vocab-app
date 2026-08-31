import type { Metadata } from "next";
import { Fraunces, IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import Script from "next/script";
import "./globals.css";

// Type system — an academic-but-warm pairing, deliberately not the system-font default:
//  · Fraunces  → literary display serif for headings/hero (words, language, reading)
//  · IBM Plex Sans → precise, legible body/UI
//  · IBM Plex Mono → data, timers, word counts ("the graded numbers")
const display = Fraunces({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
  display: "swap",
});
const body = IBM_Plex_Sans({
  subsets: ["latin"],
  variable: "--font-body",
  weight: ["400", "500", "600", "700"],
  display: "swap",
});
const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  weight: ["400", "500", "600"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Lexi — learn English by doing",
  description:
    "A personal English practice engine: active vocabulary drilling and IELTS writing feedback. Not a notebook — a coach.",
};

// Root layout is just the document shell. Chrome (nav vs. full-bleed marketing)
// is decided by the route-group layouts: (app) adds the app nav, (marketing) is
// a bare canvas for the landing page.
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`h-full ${display.variable} ${body.variable} ${mono.variable}`}
    >
      <body className="min-h-full flex flex-col">
        {/* Set the saved theme before paint (no flash). Absent = follow the OS. */}
        <Script id="lexi-theme-init" strategy="beforeInteractive">
          {`(function(){try{var t=localStorage.getItem('lexi-theme');if(t==='light'||t==='dark'){document.documentElement.dataset.theme=t;}}catch(e){}})();`}
        </Script>
        {children}
      </body>
    </html>
  );
}
