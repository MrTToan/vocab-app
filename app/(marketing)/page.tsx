import Link from "next/link";
import Image from "next/image";
import { Cormorant_Garamond, Inter } from "next/font/google";
import MarketingMotion from "./MarketingMotion";
import "./marketing.css";

// MNTN landing — an approved editorial redesign (cinematic photo hero, serif
// display type, green palette). This is a server component; all motion lives in
// the small <MarketingMotion> client island. The green/serif look is scoped to
// the `.mntn` wrapper (see marketing.css) so the authenticated app, which owns
// the global tokens in globals.css, is left untouched. Every CTA/nav/footer
// link resolves to a real route or in-page anchor; product claims are the true
// ones carried over from the previous landing page.

// Fonts are scoped to marketing via variables applied on the wrapper below —
// they are never attached to <html>, so the app's Fraunces/IBM Plex stay in place.
const cormorant = Cormorant_Garamond({
  subsets: ["latin"],
  variable: "--font-cormorant",
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
  display: "swap",
});
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  weight: ["400", "500", "600"],
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

const STATS = [
  { num: "5", cap: "stages on the mastery ladder — new to known" },
  { num: "6", cap: "exercise types, chosen by the word's stage" },
  { num: "4", cap: "official IELTS criteria scored per essay" },
  { num: "8,000+", cap: "ready-made practice questions to drill" },
];

export default function Landing() {
  return (
    <div className={`mntn ${cormorant.variable} ${inter.variable}`}>
      <MarketingMotion />

      {/* NAV */}
      <nav className="nav" id="mntn-nav">
        <Link className="logo" href="#top">
          Lexi
        </Link>
        <div className="navc">
          <Link href="/vocab">Practice</Link>
          <Link href="/writing">Writing</Link>
          <Link href="/how-it-works">How it works</Link>
        </div>
        <div className="navr">
          <Link href="/vocab" className="acct">
            Open app →
          </Link>
        </div>
      </nav>

      <div className="rail" id="mntn-rail" aria-hidden="true">
        <span className="soc">Follow the climb</span>
        <span className="bar" />
      </div>

      {/* HERO */}
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

        <Link className="hero-cta r d2" href="/vocab" aria-label="Start practicing">
          <span className="txt">Start here</span>
          <span className="disc">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M7 17L17 7M10 7H17V14"
                stroke="currentColor"
                strokeWidth="1.9"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        </Link>

        <div className="hero-in">
          <h1 className="r d1">
            Master The Words.
            <br />
            <span className="thin">And Everything Beyond.</span>
          </h1>
        </div>
        <div className="hero-foot r d3">
          <span className="down">↓</span> Scroll to begin
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
            <p className="kick r">The summit is production</p>
            <h2 className="lead-h r d1">
              A word isn&rsquo;t learned when you <i>recognise</i> it — only when
              you can <i>produce</i> it.
            </h2>
            <p className="r d2">
              Lexi climbs a five-stage ladder — new, recognition, recall,
              production, known — and a word is only &ldquo;known&rdquo; once
              you can produce it from memory. Weak or stale words resurface
              automatically, right before you&rsquo;d forget them. Paste a raw
              list and AI fills the meanings, examples, synonyms and
              collocations, with a multi-provider fallback chain so it keeps
              working even when one provider is down.
            </p>
            <a className="arrowlink r d2" href="#toolkit">
              See how it works →
            </a>
          </div>
        </div>
      </section>

      {/* STAT STRIP */}
      <section className="stats" data-reveal>
        <div className="wrap stats-in">
          {STATS.map((s) => (
            <div className="stat r d1" key={s.cap}>
              <div className="num">{s.num}</div>
              <p className="cap">{s.cap}</p>
            </div>
          ))}
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
              <h4>Pick your pack</h4>
              <p>
                Sign in with Google, then start from a curated public pack —
                IELTS Task 1 &amp; 2, Casual, Academic — or paste your own list
                and let AI enrich it.
              </p>
            </div>
            <div className="st-item r d2">
              <div className="no">02</div>
              <h4>Practice &amp; adapt</h4>
              <p>
                Lexi serves the right exercise for every word, resurfaces the
                ones slipping away, and syncs your progress across every device
                you sign in on.
              </p>
            </div>
            <div className="st-item r d3">
              <div className="no">03</div>
              <h4>Reach the summit</h4>
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
            <Link className="cbtn" href="/vocab">
              Start practicing — free →
            </Link>
            <Link className="cbtn ghost" href="/writing">
              Score my IELTS writing →
            </Link>
          </div>
          <p className="cnote r d2">
            Free to start · sign in with Google · works on your phone
          </p>
        </div>
      </section>

      <footer className="foot">
        <span className="logo">Lexi</span>
        <span>Climb to fluency — vocabulary &amp; IELTS writing.</span>
        <div className="foot-links">
          <Link href="/vocab">Vocabulary</Link>
          <Link href="/writing">Writing</Link>
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
        </div>
      </footer>
    </div>
  );
}
