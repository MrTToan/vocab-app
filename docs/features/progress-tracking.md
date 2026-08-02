# Progress tracking

Open **/progress** to see how you're doing. Every graded answer you give is logged, and this page turns
that history into simple charts (all hand-drawn — no external chart library).

## What you'll see
- **Headline tiles** — total words, how many you've practised, how many are mastered, how many are weak,
  and your current streak.
- **Mastery by stage** — how your words are spread across New → Recognition → Recall → Production →
  Known.
- **Activity (last 14 days)** — a bar per day, stacked by result (correct / almost / wrong), so you can
  see both frequency and quality over time.
- **Answer breakdown** — your overall correct / partial / incorrect split.
- **Accuracy by exercise type** — where you're strong or struggling (e.g. cloze vs. writing).
- **Most practised** — the words you've drilled most.

## Good to know
- Charts start filling from your **next real practice** — a fresh database shows empty charts, not an
  error.
- A "weak" word is one you recently got wrong or whose recent accuracy dropped below 60%; these are the
  words the picker pushes back at you.

---
*Under the hood: `app/progress/page.tsx`, `app/api/stats`, the `attempts` table.*
