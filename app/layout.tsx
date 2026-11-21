import type { Metadata } from "next";
import "./globals.css";

// PERF: no fonts here. The app's Fraunces/IBM Plex load from app/fonts.ts via
// the (app) layout (and the legal pages), and the marketing pages bring their
// own Cormorant/Inter — so the landing page doesn't download app fonts and
// vice versa.

const TITLE = "Lexi — learn English by doing";
const DESCRIPTION =
  "A personal English practice engine: active vocabulary drilling and IELTS writing feedback. Not a notebook — a coach.";

// Share previews: the og/twitter image comes from app/opengraph-image.jpg and
// app/twitter-image.jpg (file conventions); metadataBase makes their URLs
// absolute. The favicon set is app/favicon.ico + icon.svg + apple-icon.png.
export const metadata: Metadata = {
  metadataBase: new URL("https://lexi.vnfriends.com"),
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    type: "website",
    siteName: "Lexi",
    title: TITLE,
    description: DESCRIPTION,
    url: "/",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
};

// Root layout is just the document shell. Chrome (nav vs. full-bleed marketing)
// is decided by the route-group layouts: (app) adds the app nav, (marketing) is
// a bare canvas for the landing page.
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full flex flex-col">
        {children}
      </body>
    </html>
  );
}
