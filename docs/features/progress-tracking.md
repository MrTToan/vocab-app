# Progress tracking

Open **/report** — the standalone, cross-skill dashboard — to see how you're doing. (The old `/progress`
URL still works; it redirects here.) Every graded answer you give is logged, and this page turns that
history into simple charts (all hand-drawn — no external chart library). The report covers **both**
modules: your vocabulary progress and your IELTS writing analytics side by side.

## What you'll see
### Vocabulary
- **Headline tiles** — total words, how many you've practised, how many are mastered, how many are weak,
  your current streak, plus writing essays scored and average band.
- **Mastery by stage** — how your words are spread across New → Recognition → Recall → Production →
  Known.
- **Activity (last 14 days)** — a bar per day, stacked by result (correct / almost / wrong), so you can
  see both frequency and quality over time.
- **Answer breakdown** — your overall correct / partial / incorrect split.
- **Accuracy by exercise type** — where you're strong or struggling (e.g. cloze vs. writing).
- **Most practised** — the words you've drilled most.

### Writing (IELTS)
- **Average band per criterion**, an **overall band trend** over your submissions, your **most common
  mistakes** (by error type — the review view), and your **recent submissions**.

## Good to know
- Charts start filling from your **next real practice** — a fresh database shows empty charts, not an
  error.
- A "weak" word is one you recently got wrong or whose recent accuracy dropped below 60%; these are the
  words the picker pushes back at you.

---
*Under the hood: `app/(app)/report/page.tsx` (+ `/progress` redirect), `app/api/stats` &
`app/api/writing/stats`, the `attempts` + writing tables.*
