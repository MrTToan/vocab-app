import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";
import { Cormorant_Garamond, Inter } from "next/font/google";
import "./guide.css";
import GuideMotion from "./GuideMotion";

// Fonts for this page only — the MNTN pairing. Exposed as CSS variables and
// applied on the .lexi-guide wrapper, so they never leak into the app shell.
// Both are VARIABLE Google fonts (no `weight` needed), so this page ships 3
// font files: Cormorant normal + italic, Inter.
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
  title: "How Lexi works · Guide",
  description:
    "A plain-English guide to Lexi: build vocabulary, climb the mastery ladder through six exercises, and get IELTS writing scored like an examiner. Get going in about five minutes.",
};

// Public "How it works" guide. Lives in the (marketing) group so it renders
// without sign-in. Content is written for B1–B2 learners and is kept accurate
// to real app behaviour (mastery ladder, smart picker, 6 exercises, IELTS
// writing feedback, /report). Styling is scoped to `.lexi-guide` in guide.css.
export default function HowItWorks() {
  return (
    <div className={`lexi-guide ${cormorant.variable} ${inter.variable}`}>
      <GuideMotion />

      {/* NAV */}
      <nav className="nav" id="guide-nav">
        <Link className="logo" href="/">
          Lexi
        </Link>
        <div className="navc">
          <a href="#quickstart">Quickstart</a>
          <a href="#practice">Practice</a>
          <a href="#writing">Writing</a>
          <Link className="nav-cta" href="/vocab">
            Open the app →
          </Link>
        </div>
      </nav>

      {/* HERO */}
      <header className="hero in-view" id="top">
        <div className="hero-in">
          <p className="eyebrow r">The complete guide</p>
          <h1 className="r d1">
            How Lexi works.
            <br />
            <span className="thin">From first word to fluent.</span>
          </h1>
          <p className="hero-sub r d2">
            Lexi turns words you half-know into words you can actually use — and
            grades your IELTS writing like an examiner. This guide walks through
            every part of the app in plain English. New here? Start with the
            five-minute Quickstart, then dig into whatever you need.
          </p>
          <div className="hero-cta-row r d3">
            <a className="btn-solid" href="#quickstart">
              Start the Quickstart →
            </a>
            <Link className="btn-ghost" href="/vocab">
              Skip to the app
            </Link>
          </div>
        </div>
      </header>

      {/* QUICKSTART */}
      <section className="sec" id="quickstart" data-reveal>
        <div className="wrap">
          <p className="kick r">Get going · about 5 minutes</p>
          <h2 className="lead-h r d1">
            Quickstart: your first <i>five minutes</i>.
          </h2>
          <p className="sec-intro r d2">
            You don&rsquo;t need to read this whole guide to begin. Follow these
            five steps and you&rsquo;ll be practising real words in a few
            minutes. Everything else below just goes deeper.
          </p>

          <div className="steps">
            <div className="st-item r d1">
              <div className="no">01</div>
              <h4>Sign in with Google</h4>
              <p>
                One tap, no password. Signing in is how your progress follows
                you — practise on your laptop, carry on from your phone. It&rsquo;s
                free to start.
              </p>
            </div>
            <div className="st-item r d2">
              <div className="no">02</div>
              <h4>Pick a pack (or paste your own)</h4>
              <p>
                Choose a ready-made pack — <strong>IELTS Task 1</strong>,{" "}
                <strong>IELTS Task 2</strong>, <strong>Casual English 100</strong>{" "}
                or <strong>Academic Writing 100</strong> — or paste your own list
                of words and let Lexi fill in the details. <Link href="/vocab">Browse packs →</Link>
              </p>
            </div>
            <div className="st-item r d1">
              <div className="no">03</div>
              <h4>Start practising</h4>
              <p>
                Hit <strong>Study</strong> and Lexi serves one word at a time,
                choosing the right kind of exercise for each. Answer, see the
                meaning and an example, move on.
              </p>
            </div>
            <div className="st-item r d2">
              <div className="no">04</div>
              <h4>Let the words climb</h4>
              <p>
                Get a word right and it moves up the mastery ladder; miss it and
                it slips back and returns sooner. You don&rsquo;t manage any of
                this — Lexi does it for you.
              </p>
            </div>
            <div className="st-item r d1">
              <div className="no">05</div>
              <h4>Check your progress</h4>
              <p>
                Open the <Link href="/report">Report</Link>{" "}
                to see what&rsquo;s mastered, what&rsquo;s still weak, and your
                daily streak. Come
                back tomorrow — the weak words will be waiting.
              </p>
            </div>
            <div className="st-item r d2">
              <div className="no">06</div>
              <h4>Try IELTS writing</h4>
              <p>
                When you&rsquo;re ready, write a Task 1 or Task 2 answer and get
                a band estimate with real corrections. <Link href="/writing">Open Writing →</Link>
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* BUILDING VOCABULARY */}
      <section className="sec tint" id="vocab" data-reveal>
        <div className="wrap">
          <p className="kick r">Step one</p>
          <h2 className="lead-h r d1">
            Building your <i>vocabulary</i>.
          </h2>
          <p className="sec-intro r d2">
            Everything starts with words in your list. You can grab a curated
            pack, paste your own, or add them one at a time — and Lexi does the
            boring part (meanings, examples, pronunciation) for you.
          </p>

          <div className="prose r d2">
            <h3>Collections keep your words organised</h3>
            <p>
              A <strong>collection</strong> is a named group of words — like a
              folder. Manage them on the <Link href="/vocab">Home page</Link>:
              create one, rename it (name, emoji and description), or delete it.
              Deleting a collection only removes the grouping — your words stay
              safe. A word can live in several collections at once, and hitting{" "}
              <strong>Study</strong>{" "}on a collection practises just that set. It&rsquo;s
              a lens on your words, not a separate copy — your progress on a word
              is the same everywhere it appears.
            </p>

            <h3>Paste a list — the fast way to bulk-add</h3>
            <p>
              The quickest way to build a big list: open <strong>Add → Paste a
              list</strong>, paste your words (one per line, or separated by
              commas), and Lexi does the rest. For each word the AI fills in the{" "}
              <strong>Vietnamese meaning, an English definition, part of speech,
              IPA pronunciation, synonyms, common collocations, two example
              sentences</strong> and a false-friend note where it helps — so you
              never type IPA by hand.
            </p>
            <ul>
              <li>
                <strong>No duplicates.</strong> Lexi shows a preview of how many
                words are new versus already in your list, and skips repeats
                automatically.
              </li>
              <li>
                <strong>Spelling caught for you.</strong> If a word looks
                misspelled, Lexi corrects it and enriches the clean version.
              </li>
              <li>
                <strong>Up to 200 words</strong> per paste, to keep things fast
                and fair for everyone.
              </li>
            </ul>
            <p>
              Prefer one at a time? <strong>Add → Single word</strong> lets you
              type a word, tap <strong>Enrich</strong>, review the draft, edit
              anything, and save. Nothing is saved until you say so.
            </p>

            <h3>Curated packs — start with expert lists</h3>
            <p>
              Don&rsquo;t know where to begin? Adopt a ready-made public pack:{" "}
              <strong>IELTS Task 1</strong> and <strong>IELTS Task 2</strong> for
              exam vocabulary, <strong>Casual English 100</strong> for everyday
              talk, and <strong>Academic Writing 100</strong> for essays. You can
              even <strong>practise a pack before adding it</strong> — the words
              simply enter your rotation as new. When you like it, tap{" "}
              <strong>Add all</strong> and every word joins your list, keeping any
              progress you already made.
            </p>

            <h3>Private or public</h3>
            <p>
              Your own collections are <strong>private</strong> by default — only
              you see them. The curated packs are <strong>public</strong>, so
              they show up for everyone. Either way, your practice history is
              always your own.
            </p>
          </div>

          <a className="arrowlink r d2" href="/vocab">
            Add your first words →
          </a>
        </div>
      </section>

      {/* HOW PRACTICE WORKS */}
      <section className="sec" id="practice" data-reveal>
        <div className="wrap">
          <p className="kick r">The heart of it</p>
          <h2 className="lead-h r d1">
            How practice actually <i>works</i>.
          </h2>
          <p className="sec-intro r d2">
            Most apps stop at &ldquo;I&rsquo;ve seen this word.&rdquo; Lexi keeps
            going until you can <em>produce</em> it. Two things make that happen:
            a <strong>mastery ladder</strong> every word climbs, and a{" "}
            <strong>smart picker</strong> that decides what you see next.
          </p>

          <div className="prose r d2">
            <h3>The mastery ladder — five rungs</h3>
            <p>
              Every word sits on one of five rungs. Answer correctly and it
              climbs one rung; miss it and it drops one. A word only reaches{" "}
              <strong>Known</strong>{" "}after a run of four good answers in a row —
              which means you&rsquo;ll always have to <em>use</em> a word, not just
              recognise it, before Lexi calls it mastered.
            </p>
          </div>

          <div className="ladder r d2">
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

          <div className="callout r d2">
            <div className="ct">Words resurface right before you&rsquo;d forget them</div>
            <p>
              The smart picker keeps about 35 words active at a time and quietly
              chooses what&rsquo;s next. Words you just got wrong come back first,
              words your accuracy is slipping on get pushed forward, and anything
              you haven&rsquo;t seen in a few days resurfaces on its own. Mastered
              words fade out. You never build a schedule — Lexi handles the timing.
            </p>
          </div>

          <div className="prose r d2">
            <h3>Six ways to drill a word</h3>
            <p>
              Here&rsquo;s the key idea:{" "}
              <strong>the exercise is chosen by the word&rsquo;s rung</strong>, not
              by you. A brand-new word gets a gentle flashcard; a word near the
              top asks you to write your own sentence. That&rsquo;s why you
              can&rsquo;t just memorise one answer — as a word climbs, Lexi keeps
              asking more of you.
            </p>
          </div>

          <div className="kit r d2">
            <div className="item">
              <div className="shot">
                <Image
                  src="/marketing/box_flashcard.jpg"
                  alt="Flashcard exercise"
                  width={800}
                  height={600}
                  loading="lazy"
                  sizes="(max-width: 520px) 100vw, (max-width: 820px) 50vw, 33vw"
                />
              </div>
              <div className="meta">
                <h3>Flashcard</h3>
                <span className="st">Stage · New</span>
              </div>
              <p>Meet the word in context and type it back — two directions, no self-grading.</p>
            </div>
            <div className="item">
              <div className="shot">
                <Image
                  src="/marketing/box_cloze.jpg"
                  alt="Cloze (fill the gap) exercise"
                  width={800}
                  height={600}
                  loading="lazy"
                  sizes="(max-width: 520px) 100vw, (max-width: 820px) 50vw, 33vw"
                />
              </div>
              <div className="meta">
                <h3>Cloze</h3>
                <span className="st">Stage · Recognition</span>
              </div>
              <p>Fill the gap in a natural sentence — spot the word in the wild.</p>
            </div>
            <div className="item">
              <div className="shot">
                <Image
                  src="/marketing/box_recall.jpg"
                  alt="Recall from definition exercise"
                  width={800}
                  height={600}
                  loading="lazy"
                  sizes="(max-width: 520px) 100vw, (max-width: 820px) 50vw, 33vw"
                />
              </div>
              <div className="meta">
                <h3>Recall</h3>
                <span className="st">Stage · Recall</span>
              </div>
              <p>Given only the meaning, type the English word from memory.</p>
            </div>
            <div className="item">
              <div className="shot">
                <Image
                  src="/marketing/box_translation.jpg"
                  alt="Translation exercise"
                  width={800}
                  height={600}
                  loading="lazy"
                  sizes="(max-width: 520px) 100vw, (max-width: 820px) 50vw, 33vw"
                />
              </div>
              <div className="meta">
                <h3>Translation</h3>
                <span className="st">Stage · Production</span>
              </div>
              <p>Translate between English and Vietnamese, graded for meaning — not exact spelling.</p>
            </div>
            <div className="item">
              <div className="shot">
                <Image
                  src="/marketing/box_write.jpg"
                  alt="Write a sentence exercise"
                  width={800}
                  height={600}
                  loading="lazy"
                  sizes="(max-width: 520px) 100vw, (max-width: 820px) 50vw, 33vw"
                />
              </div>
              <div className="meta">
                <h3>Write a sentence</h3>
                <span className="st">Stage · Production</span>
              </div>
              <p>Use the word yourself, unaided — the AI tutor scores it and shows a better model.</p>
            </div>
            <div className="item">
              <div className="shot">
                <Image
                  src="/marketing/box_scenario.jpg"
                  alt="Scenario exercise"
                  width={800}
                  height={600}
                  loading="lazy"
                  sizes="(max-width: 520px) 100vw, (max-width: 820px) 50vw, 33vw"
                />
              </div>
              <div className="meta">
                <h3>Scenario</h3>
                <span className="st">Stage · Production</span>
              </div>
              <p>Say the right thing in a real situation — the word used with the right tone.</p>
            </div>
          </div>

          <div className="callout r d2">
            <div className="ct">Grading is forgiving on purpose</div>
            <p>
              A small typo counts as <strong>&ldquo;Almost&rdquo;</strong>, not
              wrong, and still moves you forward. Vietnamese answers ignore
              accents and accept any part of the meaning, so{" "}
              <em>con cho</em> matches <em>con chó</em>. Lexi is checking whether
              you know the word — not whether you typed it perfectly.
            </p>
          </div>

          <a className="arrowlink r d2" href="/vocab">
            Start practising now →
          </a>
        </div>
      </section>

      {/* IELTS WRITING */}
      <section className="sec tint" id="writing" data-reveal>
        <div className="wrap">
          <p className="kick r">Beyond words</p>
          <h2 className="lead-h r d1">
            IELTS writing, scored like an <i>examiner</i>.
          </h2>
          <p className="sec-intro r d2">
            Practising vocabulary is half the battle. The Writing module lets you
            prove it in full essays and get honest, detailed feedback in seconds.
          </p>

          <div className="split">
            <div className="prose r d2">
              <h3>Two tasks</h3>
              <p>
                <strong>Task 1</strong> asks you to describe a chart or graph in
                at least 150 words. <strong>Task 2</strong> asks for an essay of
                at least 250 words responding to an argument or opinion — the two
                tasks in the real IELTS exam.
              </p>
              <p>
                Add your own prompts on the{" "}
                <Link href="/writing">Writing page</Link>: for Task 2, paste the
                question; for Task 1, paste the question plus the chart image and
                Lexi reads the numbers for you to confirm. Then write your answer
                and submit — one clean attempt, scored as it stands.
              </p>
            </div>

            <div className="prose r d2">
              <h3>What the feedback gives you</h3>
              <ul>
                <li>
                  A <strong>band estimate</strong> overall and on each of the four
                  official criteria: <strong>Task Achievement</strong>,{" "}
                  <strong>Coherence &amp; Cohesion</strong>,{" "}
                  <strong>Lexical Resource</strong> and <strong>Grammar</strong>.
                </li>
                <li>
                  <strong>Inline corrections</strong> on your actual sentences —
                  each shows what to change, why, and a better word to use.
                </li>
                <li>
                  <strong>&ldquo;How to raise your band&rdquo;</strong> — a few
                  higher-level priorities, each with a model sentence to copy the
                  shape of.
                </li>
                <li>
                  Your <strong>strengths</strong>, so you keep what&rsquo;s working,
                  and an <strong>Export PDF</strong> button to save the report.
                </li>
              </ul>
            </div>
          </div>

          <div className="callout r d2">
            <div className="ct">Ask the AI &ldquo;why?&rdquo;</div>
            <p>
              Don&rsquo;t agree with a score or a correction? Every criterion,
              every coaching point and every inline fix has a{" "}
              <strong>💬 Discuss with the AI</strong> thread. Ask it to justify a
              band, rewrite a sentence, or explain a grammar point — it answers
              grounded in <em>your</em> essay, quotes your words, and can add a
              Vietnamese explanation. Your conversations are saved with the
              feedback, so you can reopen them any time.
            </p>
          </div>

          <a className="arrowlink r d2" href="/writing">
            Write your first answer →
          </a>
        </div>
      </section>

      {/* TRACKING PROGRESS */}
      <section className="sec" id="progress" data-reveal>
        <div className="wrap">
          <p className="kick r">Staying on track</p>
          <h2 className="lead-h r d1">
            See your <i>progress</i>, everywhere.
          </h2>
          <p className="sec-intro r d2">
            Open the <Link href="/report">Report</Link>{" "}
            for one dashboard across both vocabulary and writing — no numbers to log yourself, it all comes
            from your real practice.
          </p>

          <div className="split">
            <div className="prose r d2">
              <h3>What the numbers mean</h3>
              <ul>
                <li>
                  <strong>Headline tiles</strong> — total words, how many
                  you&rsquo;ve practised, how many are mastered, how many are still
                  weak, and your current daily streak.
                </li>
                <li>
                  <strong>Mastery by stage</strong> — how your words spread across
                  the five rungs, from New to Known.
                </li>
                <li>
                  <strong>Activity &amp; accuracy</strong> — your last two weeks of
                  practice and how well you do on each exercise type.
                </li>
                <li>
                  <strong>Writing</strong> — your band trend, your average per
                  criterion, and your most common mistakes.
                </li>
              </ul>
              <p>
                A word counts as <strong>weak</strong>{" "}when you&rsquo;ve recently
                got it wrong or your accuracy on it has dropped below 60% — exactly
                the words the picker brings back to you.
              </p>
            </div>

            <div className="prose r d2">
              <h3>It follows your sign-in</h3>
              <p>
                Because you sign in with Google, your progress lives with your
                account, not your device. Practise on your phone on the bus,
                open your laptop at home, and everything is exactly where you
                left it — same words, same rungs, same streak. Nothing to sync by
                hand.
              </p>
            </div>
          </div>

          <a className="arrowlink r d2" href="/report">
            Open your Report →
          </a>
        </div>
      </section>

      {/* FAQ */}
      <section className="sec tint" id="faq" data-reveal>
        <div className="wrap">
          <p className="kick r">Good to know</p>
          <h2 className="lead-h r d1">Quick answers.</h2>

          <div className="faq r d2">
            <div className="q">
              <h4>Is it really free to start?</h4>
              <p>
                Yes. Sign in and practise for free. Only two things use AI —
                enriching a new word and scoring your writing — and everything
                else (flashcards, cloze, recall, all local grading) works with no
                setup at all.
              </p>
            </div>
            <div className="q">
              <h4>Does it work on my phone?</h4>
              <p>
                Yes — the whole app is built for phones. Practise a few words
                whenever you have a spare minute; it syncs to every device you
                sign in on.
              </p>
            </div>
            <div className="q">
              <h4>Do I get mastery just by clicking through?</h4>
              <p>
                No. Mastery is <em>earned</em>, not marked. A word only reaches
                Known after four good answers in a row, and near the top you have
                to produce the word yourself — so you can&rsquo;t fake it.
              </p>
            </div>
            <div className="q">
              <h4>What if I make a typo?</h4>
              <p>
                A small typo counts as &ldquo;Almost,&rdquo; not wrong, and still
                moves you forward. Meaning matters more than perfect spelling, and
                Vietnamese answers ignore accents.
              </p>
            </div>
            <div className="q">
              <h4>Do I have to organise my own review schedule?</h4>
              <p>
                Never. Lexi&rsquo;s picker decides what you see next — weak and
                stale words resurface on their own, and mastered ones step aside.
                You just keep answering.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CLOSING */}
      <section className="close" data-reveal>
        <div className="grain" />
        <div className="in">
          <h2 className="r">
            Your climb to <i>fluency</i>
            <br />
            starts today.
          </h2>
          <div className="cbtns r d1">
            <Link className="btn-solid" href="/vocab">
              Start practising — free →
            </Link>
            <Link className="btn-ghost" href="/writing">
              Try IELTS writing
            </Link>
          </div>
          <p className="cnote r d2">
            Free to start · sign in with Google · works on your phone
          </p>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="foot">
        <div className="frow">
          <span className="logo">Lexi</span>
          <div className="flinks">
            <Link href="/">Home</Link>
            <Link href="/vocab">Practice</Link>
            <Link href="/writing">Writing</Link>
            <Link href="/privacy">Privacy</Link>
            <Link href="/terms">Terms</Link>
          </div>
          <span className="fnote">
            Climb to fluency — active vocabulary &amp; IELTS writing feedback.
          </span>
        </div>
      </footer>
    </div>
  );
}
