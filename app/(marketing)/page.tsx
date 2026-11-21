import { Suspense } from "react";
import Link from "next/link";
import Image from "next/image";
import { Cormorant_Garamond, Inter } from "next/font/google";
import MarketingMotion from "./MarketingMotion";
import SignInNote from "./SignInNote";
import AppLink from "./AppLink";
import "./marketing.css";

// MNTN landing — an approved editorial redesign (cinematic photo hero, serif
// display type, green palette). This is a server component; all motion lives in
// the small <MarketingMotion> client island. The green/serif look is scoped to
// the `.mntn` wrapper (see marketing.css) so the authenticated app, which owns
// the global tokens in globals.css, is left untouched. Every CTA/nav/footer
// link resolves to a real route or in-page anchor; product claims are the true
// ones carried over from the previous landing page. Links into gated app routes
// use <AppLink>, which sends a signed-out visitor straight to Google sign-in
// (callback = that route) instead of bouncing off proxy.ts back to this page.

// Fonts are scoped to marketing via variables applied on the wrapper below —
// they are never attached to <html>, so the app's Fraunces/IBM Plex stay in place.
// Both are VARIABLE Google fonts (no `weight` needed — see next/font docs), so
// the landing page ships 3 font files: Cormorant normal + italic, Inter.
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

const TOOLKIT = [
  {
    src: "/marketing/box_flashcard.jpg",
    alt: "A stack of embossed study cards on a warm textured surface",
    title: "Flashcard",
    stage: "Stage · New",
    body: "Meet the word in context, two ways, no self-grading.",
  },
  {
    src: "/marketing/box_cloze.jpg",
    alt: "A tile split by a gap with a piece fitting into the middle",
    title: "Cloze",
    stage: "Stage · Recognition",
    body: "Fill the gap in a natural sentence — spot it in the wild.",
  },
  {
    src: "/marketing/box_recall.jpg",
    alt: "Light drawn back into a socket — recalling a word from memory",
    title: "Recall",
    stage: "Stage · Recall",
    body: "Retrieve the word cold, from its meaning alone.",
  },
  {
    src: "/marketing/box_translation.jpg",
    alt: "Two lettered keys, E and V, joined by an arc of light",
    title: "Translation",
    stage: "Both ways",
    body: "EN↔VN, graded for meaning, not exact spelling.",
  },
  {
    src: "/marketing/box_write.jpg",
    alt: "A stone archway with a glowing lettered keystone and a gold pen",
    title: "Write a sentence",
    stage: "Stage · Production",
    body: "Use it yourself, unaided — scored by AI.",
  },
  {
    src: "/marketing/box_scenario.jpg",
    alt: "An open journal mapping a route with a pen and a guiding star",
    title: "Scenario",
    stage: "Register & tone",
    body: "Say the right thing in a real situation.",
  },
];

// The intro's benefit bullets: "**Bold benefit** — detail", learner outcomes
// only (no infrastructure talk). Every claim is a real product behaviour.
const BENEFITS = [
  {
    head: "Know a word only when you can use it",
    body: "every word climbs five stages — new, recognition, recall, production, known — and only counts as known once you can produce it from memory.",
  },
  {
    head: "Words come back before you forget them",
    body: "weak or stale words resurface automatically, right before they’d slip away.",
  },
  {
    head: "Paste any list, skip the busywork",
    body: "AI fills in meanings, examples, synonyms and collocations, or start from a ready-made IELTS, academic or casual pack.",
  },
  {
    head: "Prove it in your IELTS writing",
    body: "Task 1 and Task 2 essays scored on all four official criteria, with inline fixes and a band estimate.",
  },
];

export default function Landing() {
  return (
    <div className={`mntn ${cormorant.variable} ${inter.variable}`}>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <MarketingMotion />

      {/* NAV */}
      <nav className="nav" id="mntn-nav">
        <Link className="logo" href="#top">
          Lexi
        </Link>
        <div className="navc">
          <AppLink to="/vocab">Vocab</AppLink>
          <AppLink to="/writing">Writing</AppLink>
          <Link href="/how-it-works">How it works</Link>
          <Link href="/about">About</Link>
        </div>
        <div className="navr">
          <AppLink to="/vocab" className="acct">
            Open app →
          </AppLink>
        </div>
      </nav>

      {/* "Sign in to continue" notice + Continue with Google — rendered only
          when the sign-in proxy bounced a signed-out deep link here (?signin=1). */}
      <Suspense fallback={null}>
        <SignInNote />
      </Suspense>

      <main id="main" tabIndex={-1}>
        {/* HERO — what Lexi is and for whom, one primary action, one true proof
            line (facts only; no counts we can't verify from the code). */}
        <header className="hero" id="top">
          <div className="hero-ph">
            <Image
              src="/marketing/cover.jpg"
              alt="A mountaineer on a ridge at dawn, mist filling the valley below"
              fill
              priority
              sizes="100vw"
              style={{ objectFit: "cover" }}
            />
          </div>
          <div className="hero-shade" />

          <div className="hero-in">
            <p className="eyebrow r">English vocabulary &amp; IELTS practice</p>
            <h1 className="r d1">
              Master the words.
              <br />
              <span className="thin">Then use them.</span>
            </h1>
            <p className="hero-sub r d2">
              A word isn&rsquo;t learned when you <i>recognise</i> it — only when
              you can <i>produce</i> it. Lexi drills the English vocabulary you need
              for IELTS and everyday life until you can use every word yourself.
            </p>
            <div className="hero-cta r d3">
              <AppLink className="cbtn" to="/vocab">
                Start practicing free →
              </AppLink>
              <p className="hero-proof">
                Free to start · one tap with Google · IELTS writing scored on all
                four official criteria
              </p>
            </div>
          </div>
        </header>

        {/* INTRO SPLIT */}
        <section className="sec" id="intro" data-reveal>
          <div className="wrap split">
            <div className="ph r">
              <Image
                src="/marketing/intro.jpg"
                alt="A hiker resting at a misty mountain summit at dawn, looking out over a valley"
                fill
                sizes="(max-width: 860px) 100vw, 55vw"
                style={{ objectFit: "cover" }}
              />
            </div>
            <div className="copy">
              <p className="kick r">Recognition isn&rsquo;t mastery</p>
              <h2 className="lead-h r d1">
                Built so words <i>stick</i> — and come out when you need them.
              </h2>
              <ul className="benefits r d2">
                {BENEFITS.map((b) => (
                  <li key={b.head}>
                    <strong>{b.head}</strong> — {b.body}
                  </li>
                ))}
              </ul>
              <Link className="arrowlink r d2" href="/how-it-works">
                See how it works →
              </Link>
            </div>
          </div>
        </section>

        {/* TOOLKIT */}
        <section className="sec toolkit" id="toolkit" data-reveal>
          <div className="wrap">
            <div className="kit-head">
              <div>
                <p className="kick r">What&rsquo;s in your pack</p>
                <h2 className="lead-h r d1">Six ways to drill a word.</h2>
              </div>
              <p className="label r d1" style={{ color: "var(--moss)", maxWidth: "26ch" }}>
                The exercise adapts to where each word sits on the ladder — so you
                can&rsquo;t just memorise the answer.
              </p>
            </div>
            <div className="kit">
              {TOOLKIT.map((t, i) => (
                <div className={`item r d${(i % 3) + 1}`} key={t.title}>
                  <div className="ph">
                    <Image
                      src={t.src}
                      alt={t.alt}
                      fill
                      loading="lazy"
                      sizes="(max-width: 520px) 100vw, (max-width: 820px) 50vw, 33vw"
                      style={{ objectFit: "cover" }}
                    />
                  </div>
                  <div className="meta">
                    <h3>{t.title}</h3>
                    <span className="st">{t.stage}</span>
                  </div>
                  <p>{t.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* STEPS */}
        <section className="sec" id="steps" data-reveal>
          <div className="wrap">
            <p className="kick r">The route up</p>
            <h2 className="lead-h r d1" style={{ maxWidth: "18ch" }}>
              From a blank app to fluent, one climb at a time.
            </h2>
            <div className="steps">
              <div className="st-item r d1">
                <div className="no">01</div>
                <h3>Pick your pack</h3>
                <p>
                  Sign in with Google, then start from a curated public pack —
                  IELTS Task 1 &amp; 2, Casual, Academic — or paste your own list
                  and let AI enrich it.
                </p>
              </div>
              <div className="st-item r d2">
                <div className="no">02</div>
                <h3>Practice &amp; adapt</h3>
                <p>
                  Lexi serves the right exercise for every word, resurfaces the
                  ones slipping away, and syncs your progress across every device
                  you sign in on.
                </p>
              </div>
              <div className="st-item r d3">
                <div className="no">03</div>
                <h3>Reach the summit</h3>
                <p>
                  Watch each word climb to mastery — and prove it in real IELTS
                  Writing, scored on all four official criteria with inline fixes
                  and a band estimate.
                </p>
              </div>
            </div>
            <Link className="arrowlink r d1" href="/how-it-works">
              Read the full guide →
            </Link>
          </div>
        </section>

        {/* CLOSING */}
        <section className="close" data-reveal>
          <div className="ph2" />
          <div className="in">
            <h2 className="r">
              Your climb to <i>fluency</i>
              <br />
              starts today.
            </h2>
            <div className="close-ctas r d1">
              <AppLink className="cbtn" to="/vocab">
                Start practicing — free →
              </AppLink>
            </div>
            <p className="close-alt r d1">
              <AppLink className="textlink" to="/writing">
                Or get your IELTS writing scored →
              </AppLink>
            </p>
            <p className="cnote r d2">
              Free to start · one tap with Google · your climb fits in your pocket
            </p>
          </div>
        </section>
      </main>

      <footer className="foot">
        <span className="logo">Lexi</span>
        <div className="foot-links">
          <Link href="/about">About</Link>
          <AppLink to="/vocab">Vocabulary</AppLink>
          <AppLink to="/writing">Writing</AppLink>
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
        </div>
      </footer>
    </div>
  );
}
