# Progress tracking

Open **/report** — the standalone, cross-skill dashboard — to see how you're doing. (The old `/progress`
URL still works; it redirects here.) Every graded answer you give is logged, and this page turns that
history into simple charts (all hand-drawn inline SVG/CSS — no external chart library). The report covers
**both** modules: your vocabulary progress and your IELTS writing analytics side by side.

## What you'll see
### Vocabulary
- **How you're doing** — a headline weighted-accuracy figure (correct = 1, almost = ½, missed = 0), a
  14-day accuracy **sparkline**, a **week-over-week** delta, and your overall correct / almost / missed
  split (labelled — never colour-alone).
- **Headline tiles** — total words, mastered, current day streak (with a 14-day activity dot-strip), and
  total attempts (plus how many words need work).
- **Your climb to mastery** — every word placed on one part-to-whole bar from **New → Recognition → Recall
  → Production → Known**, coloured on an ordinal emerald ramp (deeper green = closer to mastery), with a
  headline **% Known**.
- **Practice activity (last 14 days)** — a stacked column per day (correct / almost / missed, with gaps and
  hover labels) for *how much*, plus a separate **daily-accuracy line** for *how well* — so you can see
  whether you're improving, not just how busy you were.
- **Where to focus** — accuracy by exercise type, **weakest first**, so you know what to drill next (a
  min-attempts guard keeps a tiny-sample type off the top).
- **Most practised** — the words you've drilled most.

### Writing (IELTS)
- **Summary tiles** (essays scored, average band, average length), **band by criterion** as 0–9 bars
  coloured by band, a **band-over-time trend** split into Task 1 / Task 2 small-multiple lines (y-axis
  clamped to the 4–9 band range so real movement shows), your **most common mistakes** (by error type),
  and your **recent submissions**.

## Good to know
- Charts start filling from your **next real practice** — a fresh database shows empty states, not an error.
- A "weak" word is one you recently got wrong or whose recent accuracy dropped below 60%; these are the
  words the picker pushes back at you.
- The charts use only Lexi's design tokens (cream + forest, Fraunces + IBM Plex) and are theme-aware.

## Planned next (Slice 2)
Not in the current page yet, because each needs a new/cheaper server aggregation: a **consistency
heatmap** (a longer window, riding a bounded `WHERE ts >= cutoff` so it doesn't scan all history), a
**mastery-by-word-set** breakdown, and a **named "needs work" word list**.

---
*Under the hood: `app/(app)/report/page.tsx` (+ `/progress` redirect) renders pure derivations from
`lib/report.ts` (weighted accuracy, week-over-week, min-attempts ranking, mastery pipeline — unit-tested in
`tests/report.test.ts`) with the hand-authored SVG charts in `components/report/Charts.tsx`. Data comes from
`app/api/stats` & `app/api/writing/stats`; `/api/stats` aggregates in SQL (`wordStats`/`attemptStats` in
`lib/store.ts`; pure reference + shared types in `lib/stats.ts`) instead of loading every word and attempt.
The mastery ramp lives in `app/globals.css` as report-scoped `--stage-*` tokens (kept separate from
`STAGE_VAR`, which colours the library/vocab chips).*
