import type { Metadata } from "next";
import "./globals.css";

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
    <html lang="en" className="h-full">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
