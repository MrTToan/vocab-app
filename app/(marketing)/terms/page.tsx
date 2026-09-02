import Link from "next/link";
import { body } from "@/app/fonts";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service · Lexi",
  description: "The terms under which Lexi is provided.",
};

const LAST_UPDATED = "September 1, 2026";

// Public terms of service. Lives in the (marketing) group so it renders without
// sign-in, alongside the privacy policy — both required for OAuth publishing.
export default function TermsOfService() {
  return (
    // Same font wiring as the privacy page — see the comment there.
    <div
      className={`agency app-fonts ${body.variable}`}
      style={{ background: "var(--bg)", color: "var(--ink)", minHeight: "100vh" }}
    >
      <LegalHeader />
      <main className="max-w-3xl mx-auto px-5 py-16">
        <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight">Terms of Service</h1>
        <p className="mt-3 text-sm" style={{ color: "var(--muted)" }}>Last updated: {LAST_UPDATED}</p>

        <div className="prose-legal mt-10 space-y-8">
          <Section title="A personal project">
            <p>
              Lexi is a personal, hobby project. It is provided free of charge for individual
              English-vocabulary and writing practice.
            </p>
          </Section>

          <Section title="Provided “as is”">
            <p>
              Lexi is provided &ldquo;as is&rdquo;, without warranty of any kind, express or implied. It may
              contain bugs, and its grading and feedback are automated and may be inaccurate. You
              use Lexi at your own discretion and are responsible for how you use it.
            </p>
          </Section>

          <Section title="Availability & changes">
            <p>
              As a personal project, Lexi may be changed, interrupted, or discontinued at any time
              without notice. No guarantee is made about its continued availability or the
              preservation of your data.
            </p>
          </Section>

          <Section title="Contact">
            <p>
              Questions about these terms? Contact{" "}
              <a href="mailto:vothientoan999@gmail.com">vothientoan999@gmail.com</a>.
            </p>
          </Section>
        </div>

        <FooterNav />
      </main>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-xl font-bold tracking-tight">{title}</h2>
      <div className="mt-3 space-y-3 leading-relaxed" style={{ color: "var(--muted)" }}>
        {children}
      </div>
    </section>
  );
}

function LegalHeader() {
  return (
    <header className="border-b" style={{ borderColor: "var(--line)" }}>
      <div className="max-w-3xl mx-auto px-5 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 font-extrabold text-xl tracking-tight">
          <span
            className="inline-flex items-center justify-center w-8 h-8 rounded-lg display font-bold"
            style={{ background: "var(--accent)", color: "var(--accent-ink)" }}
          >
            L
          </span>
          Lexi
        </Link>
        <Link href="/" className="text-sm font-semibold uppercase tracking-wide hover:opacity-70" style={{ color: "var(--muted)" }}>
          ← Home
        </Link>
      </div>
    </header>
  );
}

function FooterNav() {
  return (
    <div className="mt-14 pt-6 border-t flex items-center gap-5 text-sm" style={{ borderColor: "var(--line)", color: "var(--muted)" }}>
      <Link href="/" className="hover:opacity-70">Home</Link>
      <Link href="/privacy" className="hover:opacity-70">Privacy Policy</Link>
    </div>
  );
}
