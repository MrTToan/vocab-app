import Link from "next/link";

// SaaS-style landing page. Full-bleed, its own header/footer, and CTAs that drop
// visitors straight into the two modules. Static server component (fast, no data
// fetch); the app chrome lives in the (app) route group, not here.
export default function Landing() {
  return (
    <div style={{ color: "var(--ink)" }}>
      <MarketingHeader />
      <Hero />
      <StatStrip />
      <Modules />
      <Features />
      <HowItWorks />
      <FinalCta />
      <Footer />
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
            className="inline-flex items-center justify-center w-8 h-8 rounded-xl text-white"
            style={{ background: "var(--accent)" }}
          >
            L
          </span>
          Lexi
        </Link>
        <nav className="hidden sm:flex items-center gap-6 text-sm font-semibold" style={{ color: "var(--muted)" }}>
          <a href="#modules" className="hover:opacity-70">Modules</a>
          <a href="#features" className="hover:opacity-70">Why Lexi</a>
          <a href="#how" className="hover:opacity-70">How it works</a>
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
          "radial-gradient(1200px 500px at 50% -10%, var(--accent-soft), transparent 70%)",
      }}
    >
      <div className="max-w-6xl mx-auto px-5 pt-20 pb-16 text-center">
        <span className="chip mb-5">Personal English coach · not a notebook</span>
        <h1 className="text-4xl sm:text-6xl font-extrabold tracking-tight leading-[1.05]">
          Stop collecting words.
          <br />
          <span style={{ color: "var(--accent)" }}>Start using them.</span>
        </h1>
        <p className="mt-6 text-lg sm:text-xl max-w-2xl mx-auto" style={{ color: "var(--muted)" }}>
          Lexi drills your vocabulary until you can produce it, and scores your IELTS
          writing against the official criteria with inline, line-by-line feedback.
          Two skills, one focused practice engine.
        </p>
        <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
          <Link href="/vocab" className="btn btn-primary text-base px-6 py-3">
            Start practicing — free
          </Link>
          <Link href="/writing" className="btn text-base px-6 py-3">
            Try IELTS writing feedback
          </Link>
        </div>
        <p className="mt-4 text-xs" style={{ color: "var(--muted)" }}>
          Runs on your machine · your words never leave your database · no sign-up to start
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
    <div className="card max-w-2xl mx-auto p-5 sm:p-6 text-left shadow-sm">
      <div className="flex items-center justify-between">
        <span className="chip">IELTS Task 2 · feedback</span>
        <span className="text-sm font-bold" style={{ color: "var(--good)" }}>Band 6.5</span>
      </div>
      <p className="mt-4 leading-relaxed">
        Many people believe that{" "}
        <mark
          style={{ background: "var(--bad-soft)", color: "var(--bad)", padding: "0 2px", borderRadius: 4 }}
        >
          technology have
        </mark>{" "}
        made our lives easier, and this essay will{" "}
        <mark
          style={{ background: "var(--warn-soft)", color: "var(--warn)", padding: "0 2px", borderRadius: 4 }}
        >
          talk about
        </mark>{" "}
        both views.
      </p>
      <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
        <Correction color="var(--bad)" tag="grammar" from="technology have" to="technology has" />
        <Correction color="var(--warn)" tag="lexical" from="talk about" to="examine / explore" />
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

function Correction({ color, tag, from, to }: { color: string; tag: string; from: string; to: string }) {
  return (
    <div className="rounded-lg px-3 py-2" style={{ background: "var(--panel)", border: "1px solid var(--line)" }}>
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
    ["1,100+", "words in active rotation"],
    ["33,000+", "non-repeating practice questions"],
    ["4", "IELTS criteria scored per essay"],
    ["100%", "of your data stays local"],
  ];
  return (
    <section className="border-y" style={{ borderColor: "var(--line)" }}>
      <div className="max-w-6xl mx-auto px-5 py-10 grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
        {stats.map(([n, label]) => (
          <div key={label}>
            <div className="text-3xl font-extrabold tracking-tight" style={{ color: "var(--accent)" }}>{n}</div>
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
        Pick what you need today. Both modules share the same relentless focus on
        production over recognition.
      </p>
      <div className="mt-12 grid grid-cols-1 md:grid-cols-2 gap-6">
        <ModuleCard
          badge="Vocabulary"
          title="Drill words until they're yours"
          points={[
            "A per-word stage ladder: new → recognition → recall → production",
            "A smart picker resurfaces weak words and cycles a working set",
            "Mostly-typed exercises — cloze, translation, scenarios — graded instantly",
            "Never the same question twice, from a bank of 30+ per word",
          ]}
          href="/vocab"
          cta="Practice vocabulary"
        />
        <ModuleCard
          badge="IELTS Writing"
          title="Feedback like a real examiner"
          points={[
            "Academic Task 1 (charts) and Task 2 (essays)",
            "Scored on all four official IELTS criteria, with band estimates",
            "Inline corrections, better-word suggestions, and error logging",
            "Grades by your own teacher's rules, injected into every review",
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
    <div className="card p-7 flex flex-col">
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
    ["Production, not recognition", "You type answers. Lexi only counts a word learned once you can actually produce it — not just recognize it in a list."],
    ["Spaced & adaptive", "Weak words resurface; mastered ones rest. A streak-based ladder decides what you see, so effort goes where it's needed."],
    ["Real examiner feedback", "Essays are scored on Task, Coherence, Lexical Resource and Grammar — with inline fixes and a band estimate, not vague praise."],
    ["Learns your mistakes", "Every correction is logged by error type, so your report shows the exact patterns to fix next."],
    ["Private by default", "Your words, essays and progress live in a local database on your machine. Nothing is uploaded or shared."],
    ["Your rules, applied", "Add your teacher's formulas and advice; Lexi injects them into every score so feedback matches how you're taught."],
  ];
  return (
    <section id="features" style={{ background: "var(--panel)" }} className="border-y" >
      <div className="max-w-6xl mx-auto px-5 py-20" style={{ borderColor: "var(--line)" }}>
        <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-center">Built to make it stick</h2>
        <div className="mt-12 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {feats.map(([title, body]) => (
            <div key={title} className="rounded-2xl p-6" style={{ background: "var(--bg)", border: "1px solid var(--line)" }}>
              <div className="w-10 h-10 rounded-xl mb-4 flex items-center justify-center text-white font-extrabold" style={{ background: "var(--accent)" }}>
                ★
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
    ["Add or import", "Bring your word list, or drop in IELTS prompts. Lexi enriches and organizes them."],
    ["Practice daily", "Type answers to varied exercises, or write a full essay against a real prompt."],
    ["See what to fix", "Instant grading and a cross-skill report show your weak words and recurring errors."],
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
        className="max-w-5xl mx-auto rounded-3xl px-8 py-14 text-center"
        style={{ background: "var(--accent)", color: "#fff" }}
      >
        <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight">Ready to practice with intent?</h2>
        <p className="mt-3 text-lg" style={{ opacity: 0.9 }}>
          Jump into a session now — no setup required to get started.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/vocab"
            className="btn text-base px-6 py-3"
            style={{ background: "#fff", color: "var(--accent)", borderColor: "#fff" }}
          >
            Start with vocabulary
          </Link>
          <Link
            href="/writing"
            className="btn text-base px-6 py-3"
            style={{ background: "transparent", color: "#fff", borderColor: "rgba(255,255,255,0.6)" }}
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
        <p>A personal English practice engine. Built for one focused learner.</p>
        <div className="flex items-center gap-5">
          <Link href="/vocab" className="hover:opacity-70">Vocabulary</Link>
          <Link href="/writing" className="hover:opacity-70">Writing</Link>
        </div>
      </div>
    </footer>
  );
}
