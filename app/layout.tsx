import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";

// PERF: no fonts here. The app's Fraunces/IBM Plex load from app/fonts.ts via
// the (app) layout (and the legal pages), and the marketing pages bring their
// own Cormorant/Inter — so the landing page doesn't download app fonts and
// vice versa.

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
    <html lang="en" suppressHydrationWarning className="h-full">
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
