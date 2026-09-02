import Link from "next/link";
import type { Metadata } from "next";
import { Cormorant_Garamond, Inter } from "next/font/google";
import "./about.css";
import AboutMotion from "./AboutMotion";

// Fonts for this page only — the same MNTN pairing as the landing and the
// how-it-works guide. Exposed as CSS variables and applied on the .lexi-about
// wrapper, so they never leak into the app shell. Both are VARIABLE Google
// fonts (no `weight` needed), so this page ships 3 font files: Cormorant normal
// + italic, Inter.
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
  title: "About Lexi",
  description:
    "Why Lexi exists, who made it, how it works, and what happens to your data. A vocabulary tool built on one belief: you only truly know a word when you can produce it from memory.",
};

// Public "About" page. Lives in the (marketing) group so it renders without
// sign-in — the same as the landing and the how-it-works guide. It shares their
// green/serif "climb" design system (scoped to `.lexi-about` in about.css) so
// the three pages read as one site. Every claim here is kept true to real app
// behaviour and to the published Privacy Policy; product mechanics come from
// docs/features and the how-it-works guide, not invention.
export default function About() {
  return (
    <div className={`lexi-about ${cormorant.variable} ${inter.variable}`}>
      <AboutMotion />

      {/* NAV */}
      <nav className="nav" id="about-nav">
        <Link className="logo" href="/">
          Lexi
        </Link>
        <div className="navc">
          <Link href="/how-it-works">How it works</Link>
          <Link href="/privacy">Privacy</Link>
          <Link className="nav-cta" href="/vocab">
            Start practicing
          </Link>
        </div>
      </nav>

      {/* HERO — the belief, carried by the words */}
      <header className="hero" id="about-hero">
        <p className="belief r d1">
          Recognising a word isn&rsquo;t knowing it.
          <span className="turn r d2">
            You know a word when you can <i>produce</i> it — from memory, the
            moment you need it.
          </span>
        </p>
        <p className="sig r d2">The one belief the whole tool is built on</p>
      </header>

      {/* THE MAKER'S STORY */}
      <section className="sec">
        <div className="wrap">
          <p className="kick">Why it exists</p>
          <h2 className="lead-h">
            I built the tool I <i>wished</i> existed.
          </h2>

          <div className="story">
            <p className="drop">
              I built Lexi for myself first. I&rsquo;d spent years reading
              English — I could recognise thousands of words on a page and nod
              along. But when I sat down to write, or had to say the thing out
              loud, most of them weren&rsquo;t there. I knew them the way you
              know a face you can&rsquo;t put a name to.
            </p>
            <p>
              That gap bothered me. Every vocabulary app I tried measured the
              wrong thing: it showed me a word, I thought &ldquo;yes, I know
              that,&rdquo; and it took my word for it. Recognition felt like
              progress, but it wasn&rsquo;t the skill I actually needed. I
              didn&rsquo;t want to recognise words. I wanted to reach for them.
            </p>
            <p>
              So I built something that refuses to call a word &ldquo;known&rdquo;
              until I can produce it from memory, cold. I use it every day. At
              some point keeping it to myself started to feel a little selfish,
              so I opened it up to anyone who wants it.
            </p>
            <p>
              It&rsquo;s still a solo, independent project — no team, no company
              behind it, no &ldquo;we, a group of experts.&rdquo; Just one
              learner&rsquo;s honest answer to a problem I couldn&rsquo;t shake,
              shared in case it helps you too.
            </p>
          </div>

          {/* TODO(captain): swap in your name/handle here if you want it public */}
          <p className="byline">— the maker of Lexi</p>
        </div>
      </section>

      {/* HOW IT ACTUALLY WORKS — THE METHOD */}
      <section className="sec tint">
        <div className="wrap">
          <p className="kick">The method</p>
          <h2 className="lead-h">
            How that belief becomes a <i>practice</i>.
          </h2>
          <p className="method-intro">
            The idea only matters if the tool holds you to it. So every word
            climbs a five-stage ladder, and a word is never marked mastered on
            recognition alone — you have to produce it, and keep producing it,
            first.
          </p>

          <div className="ladder">
            <div className="rung">
              <span className="dot" />
              <span className="rk">New</span>
              <span className="rd">Just met. You see it in context first, no pressure.</span>
            </div>
            <div className="rung">
              <span className="dot" />
              <span className="rk">Recognition</span>
              <span className="rd">You can spot it in a sentence and fill the gap.</span>
            </div>
            <div className="rung">
              <span className="dot" />
              <span className="rk">Recall</span>
              <span className="rd">You can retrieve the word from its meaning alone.</span>
            </div>
            <div className="rung">
              <span className="dot" />
              <span className="rk">Production</span>
              <span className="rd">You can use it yourself — in a sentence, a translation, a real reply.</span>
            </div>
            <div className="rung">
              <span className="dot" />
              <span className="rk">Known</span>
              <span className="rd">Mastered. It quietly steps out of rotation so you focus on the rest.</span>
            </div>
          </div>

          <p className="method-note">
            The exercises are mostly typed, not multiple-choice, and the kind you
            get is chosen by where the word sits on the ladder — a gentle
            flashcard low down, writing your own sentence near the top. So you
            can&rsquo;t coast on one memorised answer. A word only reaches{" "}
            <strong>Known</strong> after four good answers in a row, and by then
            you&rsquo;ve had to produce it yourself. Weak and stale words
            resurface on their own, right before you&rsquo;d forget them, so
            nothing you&rsquo;ve worked for quietly slips away.{" "}
            <Link
              href="/how-it-works"
              style={{ color: "var(--gold)", borderBottom: "1px solid var(--gold)" }}
            >
              See the full method
            </Link>
            .
          </p>
        </div>
      </section>

      {/* TRUST & TRANSPARENCY */}
      <section className="sec">
        <div className="wrap">
          <p className="kick">Your data</p>
          <h2 className="lead-h">
            Plainly, what happens to your <i>data</i>.
          </h2>

          <div className="trust">
            <div className="row">
              <h3>It&rsquo;s yours, and it&rsquo;s isolated</h3>
              <p>
                Lexi is multi-tenant: your words, your progress and your writing
                live under your account and yours alone. Other people using Lexi
                can&rsquo;t see any of it. The curated word packs are shared, but
                your practice history never is.
              </p>
            </div>
            <div className="row">
              <h3>Google sign-in, no passwords</h3>
              <p>
                You sign in with Google, so there&rsquo;s no password for Lexi to
                store or leak — it never sees one. It keeps your email, name and
                profile picture only to know which account is yours.
              </p>
            </div>
            <div className="row">
              <h3>Self-hosted and independent</h3>
              <p>
                Lexi runs on its own server, not on a big platform. Your data
                sits in one database there. It isn&rsquo;t sold and isn&rsquo;t
                shared — with one honest exception: the text you submit for the
                two AI features, enriching a new word and scoring your writing,
                is sent to a few third-party AI providers only to produce that
                result, and only when you use those features.
              </p>
            </div>
            <div className="row">
              <h3>You can read it all, or delete it</h3>
              <p>
                The full details — exactly what&rsquo;s collected, which
                providers, and how to get your data out or have it deleted — are
                in the <Link href="/privacy">Privacy Policy</Link> and{" "}
                <Link href="/terms">Terms of Service</Link>. Nothing on this page
                is hidden in the fine print.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* QUIET CLOSE + CTA */}
      <section className="close">
        <div className="in">
          <h2>
            Learn a word until it&rsquo;s <i>yours</i>.
          </h2>
          <p>
            No pitch, no pressure. If the belief at the top of this page rings
            true, the rest is just practice. Sign in with Google and try it.
          </p>
          <div className="cta-row">
            <Link className="btn-solid" href="/vocab">
              Start practicing
            </Link>
            <span className="cnote">Free to start · one tap with Google</span>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="foot">
        <div className="frow">
          <span className="logo">Lexi</span>
          <div className="flinks">
            <Link href="/">Home</Link>
            <Link href="/how-it-works">How it works</Link>
            <Link href="/about">About</Link>
            <Link href="/vocab">Practice</Link>
            <Link href="/writing">Writing</Link>
            <Link href="/privacy">Privacy</Link>
            <Link href="/terms">Terms</Link>
          </div>
          <span className="fnote">
            An independent tool for active vocabulary &amp; IELTS writing feedback.
          </span>
        </div>
      </footer>
    </div>
  );
}
