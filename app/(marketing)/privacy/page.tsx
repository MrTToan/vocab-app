import Link from "next/link";
import type { Metadata } from "next";
import { body } from "@/app/fonts";

export const metadata: Metadata = {
  title: "Privacy Policy · Lexi",
  description: "How Lexi collects, uses, and stores your data.",
};

const LAST_UPDATED = "September 1, 2026";

// Public privacy policy. Lives in the (marketing) group so it renders without
// sign-in — Google requires a publicly reachable privacy URL to publish the
// OAuth consent screen.
export default function PrivacyPolicy() {
  return (
    // `.agency` sets everything (headings included) in the body face, so this
    // page only needs IBM Plex Sans; `app-fonts` re-applies the family here
    // since the root layout no longer loads fonts (see app/fonts.ts).
    <div
      className={`agency app-fonts ${body.variable}`}
      style={{ background: "var(--bg)", color: "var(--ink)", minHeight: "100vh" }}
    >
      <LegalHeader />
      <main className="max-w-3xl mx-auto px-5 py-16">
        <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight">Privacy Policy</h1>
        <p className="mt-3 text-sm" style={{ color: "var(--muted)" }}>Last updated: {LAST_UPDATED}</p>

        <div className="prose-legal mt-10 space-y-8">
          <Section title="What Lexi is">
            <p>
              Lexi is a personal English-vocabulary and IELTS-writing practice app. It helps you
              drill vocabulary until you can produce it and gives feedback on your writing. This
              policy explains what data Lexi collects, how it is used, and how it is stored.
            </p>
          </Section>

          <Section title="What data is collected">
            <p>When you sign in with Google, Lexi receives from your Google account:</p>
            <ul>
              <li>Your email address, name, and profile picture — used only to identify your account.</li>
            </ul>
            <p>As you use the app, Lexi stores the content you create:</p>
            <ul>
              <li>Your vocabulary words and word collections.</li>
              <li>Your practice attempts and question history.</li>
              <li>Your writing submissions and their feedback.</li>
            </ul>
          </Section>

          <Section title="How your data is used">
            <p>
              Your data is used solely to provide the vocabulary- and writing-practice service —
              to track your progress, resurface weak words, and grade your writing. Each user&rsquo;s
              data is isolated to their own account; other users cannot see it.
            </p>
          </Section>

          <Section title="Third-party AI providers">
            <p>
              To grade written answers and enrich vocabulary words, the text you submit for those
              features may be sent to third-party AI providers for processing — specifically Google
              Gemini, Groq, and OpenAI. Only the text needed for the requested feature is sent, and
              only when you use a feature that requires it.
            </p>
          </Section>

          <Section title="Storage & sharing">
            <p>
              Your data is stored in a database on the app&rsquo;s own server. It is not sold, and it is
              not shared with anyone beyond the AI providers listed above, which are used only to
              deliver the writing-feedback and word-enrichment features.
            </p>
          </Section>

          <Section title="Data access & deletion">
            <p>
              To request access to, or deletion of, your data, contact{" "}
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
      <Link href="/terms" className="hover:opacity-70">Terms of Service</Link>
    </div>
  );
}
