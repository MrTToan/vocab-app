import Link from "next/link";
import Reveal from "@/components/Reveal";

// SaaS-style landing page. Full-bleed, its own header/footer, and CTAs that drop
// visitors straight into the two modules. Static server component (fast, no data
// fetch); the app chrome lives in the (app) route group, not here.
export default function Landing() {
  return (
    <div className="agency" style={{ background: "var(--bg)", color: "var(--ink)", minHeight: "100vh" }}>
      <MarketingHeader />
      <Hero />
      <Marquee />
      <Reveal><StatStrip /></Reveal>
      <Reveal><Modules /></Reveal>
      <Reveal><Features /></Reveal>
      <Reveal><HowItWorks /></Reveal>
      <Reveal><FinalCta /></Reveal>
      <Footer />
    </div>
  );
}

// Scrolling keyword ticker — the agency signature. Content is duplicated so the
// -50% translate loops seamlessly.
function Marquee() {
  const items = [
    "Spaced repetition",
    "Production over recognition",
    "AI-enriched words",
    "IELTS Writing feedback",
    "Cloze · Translate · Scenario",
    "Curated collections",
  ];
  const run = (ariaHidden: boolean) => (
    <span className="inline-flex items-center" aria-hidden={ariaHidden || undefined}>
      {items.map((t, i) => (
        <span key={t} className="inline-flex items-center">
          <span className={i % 2 ? "text-outline" : ""} style={i % 2 ? {} : { color: "var(--ink)" }}>
            {t}
          </span>
          <span className="mx-6 text-2xl" style={{ color: "var(--accent)" }}>✳</span>
        </span>
      ))}
    </span>
  );
  return (
    <div className="overflow-hidden border-y select-none" style={{ borderColor: "var(--line)" }}>
      <div className="marquee-track py-5 text-3xl sm:text-4xl display font-bold uppercase tracking-tight">
        {run(false)}
        {run(true)}
      </div>
    </div>
  );
}

function MarketingHeader() {
  return (
    <header
      className="sticky top-0 z-20 backdrop-blur border-b"
      style={{
        borderColor: "var(--line)",
        background: "color-mix(in srgb, var(--bg) 82%, transparent)",
      }}
    >
      <div className="max-w-6xl mx-auto px-5 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 font-extrabold text-xl tracking-tight">
          <span
            className="inline-flex items-center justify-center w-8 h-8 rounded-lg display font-bold"
            style={{ background: "var(--accent)", color: "var(--accent-ink)" }}
          >
            L
          </span>
          Lexi
        </Link>
        <nav className="hidden sm:flex items-center gap-7 text-sm font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
          <a href="#modules" className="hover:text-[color:var(--accent)] transition-colors">Modules</a>
          <a href="#features" className="hover:text-[color:var(--accent)] transition-colors">Why Lexi</a>
          <a href="#how" className="hover:text-[color:var(--accent)] transition-colors">How it works</a>
        </nav>
        <Link href="/vocab" className="btn btn-primary text-sm">Open app →</Link>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section
      className="relative overflow-hidden"
      style={{
        background:
          "radial-gradient(1100px 520px at 50% -12%, color-mix(in srgb, var(--accent) 20%, transparent), transparent 68%)",
      }}
    >
      <div className="max-w-6xl mx-auto px-5 pt-20 pb-16 text-center">
        <span className="chip mb-6 fade-up inline-block uppercase tracking-wide">A practice engine · not a vocab notebook</span>
        <h1 className="text-5xl sm:text-7xl lg:text-8xl fade-up" style={{ animationDelay: "0.08s" }}>
          Learn words that
          <br />
          actually <span className="grad-accent">stick</span>.
        </h1>
        <p
          className="mt-6 text-lg sm:text-xl max-w-2xl mx-auto fade-up"
          style={{ color: "var(--muted)", animationDelay: "0.16s" }}
        >
          Most apps just log your words. Lexi drills them — with cloze, translation,
          write-your-own-sentence and more — until you can produce them from memory,
          and quietly resurfaces the ones you're about to forget.
        </p>
        <div className="mt-9 flex flex-wrap items-center justify-center gap-3 fade-up" style={{ animationDelay: "0.24s" }}>
          <Link href="/vocab" className="btn btn-primary text-base px-6 py-3">
            Start practicing — free
          </Link>
          <Link href="/writing" className="btn text-base px-6 py-3">
            Score my IELTS writing
          </Link>
        </div>
        <p className="mt-4 text-xs fade-up" style={{ color: "var(--muted)", animationDelay: "0.3s" }}>
          Sign in with Google · start with curated IELTS &amp; everyday-English packs · works on your phone
        </p>

        <div className="mt-14">
          <PreviewCard />
        </div>
      </div>
    </section>
  );
}

// A stylized product preview so the hero shows, not just tells.
function PreviewCard() {
  return (
    <div className="card max-w-2xl mx-auto p-5 sm:p-6 text-left shadow-sm fade-up" style={{ animationDelay: "0.4s" }}>
      <div className="flex items-center justify-between">
        <span className="chip">IELTS Task 2 · feedback</span>
        <span className="text-sm font-bold fade-up" style={{ color: "var(--good)", animationDelay: "1.25s" }}>Band 6.5</span>
      </div>
      <p className="mt-4 leading-relaxed">
        Many people believe that{" "}
        <mark
          className="hl-draw"
          style={{ backgroundImage: "linear-gradient(var(--bad-soft), var(--bad-soft))", color: "var(--bad)", animationDelay: "0.75s" }}
        >
          technology have
        </mark>{" "}
        made our lives easier, and this essay will{" "}
        <mark
          className="hl-draw"
          style={{ backgroundImage: "linear-gradient(var(--warn-soft), var(--warn-soft))", color: "var(--warn)", animationDelay: "0.95s" }}
        >
          talk about
        </mark>{" "}
        both views.
      </p>
      <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
        <Correction color="var(--bad)" tag="grammar" from="technology have" to="technology has" delay={1.05} />
        <Correction color="var(--warn)" tag="lexical" from="talk about" to="examine / explore" delay={1.15} />
      </div>
      <div className="mt-4 grid grid-cols-4 gap-2 text-center text-xs" style={{ color: "var(--muted)" }}>
        {[
          ["Task", "6"],
          ["Coherence", "7"],
          ["Lexical", "6"],
          ["Grammar", "6"],
        ].map(([k, v]) => (
          <div key={k} className="rounded-lg py-2" style={{ background: "var(--accent-soft)" }}>
            <div className="font-extrabold text-base" style={{ color: "var(--accent)" }}>{v}</div>
            {k}
          </div>
        ))}
      </div>
    </div>
  );
}

function Correction({ color, tag, from, to, delay = 0 }: { color: string; tag: string; from: string; to: string; delay?: number }) {
  return (
    <div className="rounded-lg px-3 py-2 fade-up" style={{ background: "var(--panel)", border: "1px solid var(--line)", animationDelay: `${delay}s` }}>
      <span className="font-bold" style={{ color }}>{tag}</span>
      <div className="mt-0.5">
        <span style={{ textDecoration: "line-through", opacity: 0.6 }}>{from}</span>{" "}
        → <span className="font-semibold">{to}</span>
      </div>
    </div>
  );
}

function StatStrip() {
  const stats = [
    ["5", "stages on the mastery ladder"],
    ["6", "exercise types that keep it fresh"],
    ["4", "IELTS criteria scored per essay"],
    ["8,000+", "ready-made practice questions"],
  ];
  return (
    <section className="border-y" style={{ borderColor: "var(--line)" }}>
      <div className="max-w-6xl mx-auto px-5 py-10 grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
        {stats.map(([n, label]) => (
          <div key={label}>
            <div className="display text-4xl" style={{ color: "var(--accent)" }}>{n}</div>
            <div className="text-sm mt-1" style={{ color: "var(--muted)" }}>{label}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Modules() {
  return (
    <section id="modules" className="max-w-6xl mx-auto px-5 py-20">
      <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-center">Two skills, one engine</h2>
      <p className="mt-3 text-center max-w-2xl mx-auto" style={{ color: "var(--muted)" }}>
        Build the words and write the essays — both modules share the same relentless
        focus on producing English, not just recognizing it.
      </p>
      <div className="mt-12 grid grid-cols-1 md:grid-cols-2 gap-6">
        <ModuleCard
          badge="Vocabulary"
          title="Drill words until they're yours"
          points={[
            "A mastery ladder: new → recognition → recall → production → known",
            "Weak and stale words resurface automatically — mastery is earned, not marked",
            "Six exercise types, chosen by the word's stage, so you can't just memorize the answer",
            "Paste a list and AI fills the meanings, examples, synonyms and collocations",
          ]}
          href="/vocab"
          cta="Practice vocabulary"
        />
        <ModuleCard
          badge="IELTS Writing"
          title="Feedback like a real examiner"
          points={[
            "Academic Task 1 (charts) and Task 2 (essays), scored on all four official criteria",
            "Inline corrections, better-word suggestions, and a band estimate",
            "Prioritized coaching on the real levers to your next band — with model sentences",
            "Discuss any score or fix with the AI — ask why, or ask for a rewrite",
          ]}
          href="/writing"
          cta="Try writing feedback"
        />
      </div>
    </section>
  );
}

function ModuleCard({
  badge,
  title,
  points,
  href,
  cta,
}: {
  badge: string;
  title: string;
  points: string[];
  href: string;
  cta: string;
}) {
  return (
    <div className="card p-7 flex flex-col hover-lift">
      <span className="chip self-start">{badge}</span>
      <h3 className="mt-4 text-2xl font-extrabold tracking-tight">{title}</h3>
      <ul className="mt-4 space-y-2 flex-1">
        {points.map((p) => (
          <li key={p} className="flex gap-2 text-sm" style={{ color: "var(--muted)" }}>
            <span style={{ color: "var(--accent)" }}>✓</span>
            <span>{p}</span>
          </li>
        ))}
      </ul>
      <Link href={href} className="btn btn-primary mt-6 self-start">{cta} →</Link>
    </div>
  );
}

function Features() {
  const feats = [
    ["🪜", "Mastery you earn, not mark", "Every word climbs new → recognition → recall → production → known. Get it right and it moves up; slip and it drops back. Nothing is “learned” until you can produce it four times running."],
    ["🎲", "Fresh every single time", "Six exercise types — flashcard, cloze, type-the-word, translate, write-a-sentence, scenario — and the one you get is chosen by the word's stage. You can't game it by memorizing an answer."],
    ["🧠", "Paste a list, AI does the rest", "Drop in raw words and AI fills the meanings, examples, synonyms and collocations. A resilient multi-provider model chain keeps it running even when one provider is down."],
    ["✍️", "Feedback like a real examiner", "IELTS essays scored on all four official criteria — Task Achievement, Coherence & Cohesion, Lexical Resource, Grammar — with a band estimate, inline fixes, and the higher-order moves that reach the next band."],
    ["💬", "Ask the AI “why”", "Not sure about a band or a correction? Open a thread on any score or fix and ask — the tutor answers from your actual essay and remembers the conversation."],
    ["🚀", "Start with a real head start", "Skip the blank app. Curated public packs — IELTS Task 1 & 2, Casual English, Academic Writing — drop straight into practice, and your progress syncs across every device you sign in on."],
  ];
  return (
    <section id="features" style={{ background: "var(--panel)" }} className="border-y" >
      <div className="max-w-6xl mx-auto px-5 py-20" style={{ borderColor: "var(--line)" }}>
        <h2 className="text-3xl sm:text-4xl font-bold text-center">Built to make it stick</h2>
        <div className="mt-12 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {feats.map(([icon, title, body], i) => (
            <div key={title} className="rounded-2xl p-6 hover-lift" style={{ background: "var(--bg)", border: "1px solid var(--line)" }}>
              <div className="flex items-baseline justify-between mb-3">
                <span className="display text-3xl font-bold" style={{ color: "var(--accent)" }}>
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="text-xl" style={{ opacity: 0.85 }}>{icon}</span>
              </div>
              <h3 className="font-bold text-lg">{title}</h3>
              <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>{body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function HowItWorks() {
  const steps = [
    ["Sign in and pick a pack", "Sign in with Google and start with a curated collection, or paste your own words and let AI enrich them."],
    ["Practice, and let it adapt", "Type your answers to varied exercises, or write a full essay against a real prompt. The engine decides what you see next."],
    ["Watch words climb to mastery", "Instant grading, IELTS bands, and a progress dashboard show what's sticking — and quietly bring back what isn't."],
  ];
  return (
    <section id="how" className="max-w-6xl mx-auto px-5 py-20">
      <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-center">How it works</h2>
      <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-6">
        {steps.map(([title, body], i) => (
          <div key={title} className="text-center">
            <div className="mx-auto w-12 h-12 rounded-full flex items-center justify-center text-xl font-extrabold" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
              {i + 1}
            </div>
            <h3 className="mt-4 font-bold text-lg">{title}</h3>
            <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>{body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section className="px-5 pb-20">
      <div
        className="max-w-5xl mx-auto rounded-3xl px-8 py-16 text-center"
        style={{ background: "var(--accent)", color: "var(--accent-ink)" }}
      >
        <h2 className="text-4xl sm:text-6xl">Ready to make words stick?</h2>
        <p className="mt-4 text-lg" style={{ opacity: 0.85 }}>
          Jump into a curated pack now — sign in with Google and your first session is one tap away.
        </p>
        <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/vocab"
            className="btn text-base px-6 py-3"
            style={{ background: "var(--accent-ink)", color: "var(--accent)", borderColor: "var(--accent-ink)" }}
          >
            Start with vocabulary
          </Link>
          <Link
            href="/writing"
            className="btn text-base px-6 py-3"
            style={{ background: "transparent", color: "var(--accent-ink)", borderColor: "color-mix(in srgb, var(--accent-ink) 45%, transparent)" }}
          >
            Score an essay
          </Link>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t" style={{ borderColor: "var(--line)" }}>
      <div className="max-w-6xl mx-auto px-5 py-10 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm" style={{ color: "var(--muted)" }}>
        <div className="flex items-center gap-2 font-extrabold" style={{ color: "var(--ink)" }}>
          <span className="inline-flex items-center justify-center w-6 h-6 rounded-lg text-white text-xs" style={{ background: "var(--accent)" }}>L</span>
          Lexi
        </div>
        <p>An English practice engine that makes words stick.</p>
        <div className="flex items-center gap-5">
          <Link href="/vocab" className="hover:opacity-70">Vocabulary</Link>
          <Link href="/writing" className="hover:opacity-70">Writing</Link>
          <Link href="/privacy" className="hover:opacity-70">Privacy</Link>
          <Link href="/terms" className="hover:opacity-70">Terms</Link>
        </div>
      </div>
    </footer>
  );
}
