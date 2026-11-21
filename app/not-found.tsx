import Link from "next/link";
import type { Metadata } from "next";
import { Cormorant_Garamond, Inter } from "next/font/google";
import "./(marketing)/marketing.css";

// Branded 404 for unmatched URLs, in the marketing (MNTN) look: it reuses the
// `.mntn`-scoped landing styles + the same next/font pairing on the wrapper, so
// nothing leaks into the authenticated app's global tokens. Static, no auth.
const cormorant = Cormorant_Garamond({
  subsets: ["latin"],
  variable: "--font-cormorant",
  style: ["normal", "italic"],
  display: "swap",
});
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Page not found — Lexi",
};

export default function NotFound() {
  return (
    <div className={`mntn nf ${cormorant.variable} ${inter.variable}`}>
      <nav className="nav">
        <Link className="logo" href="/">
          Lexi
        </Link>
      </nav>
      <main className="nf-in" id="main">
        <p className="kick">404 · Off the trail</p>
        <h1>
          This path <i>doesn&rsquo;t</i> lead anywhere.
        </h1>
        <p className="nf-sub">
          The page you were looking for has moved or never existed. Head back to
          the start and pick up the climb from there.
        </p>
        <div className="nf-ctas">
          <Link className="cbtn" href="/">
            Back to Lexi →
          </Link>
          <Link className="textlink" href="/how-it-works">
            See how Lexi works
          </Link>
        </div>
      </main>
    </div>
  );
}
