# Admin portal (owner-only)

The **site owner**'s portal at `/admin`, a tabbed surface with three subtabs:
**Overview** (a read-only usage dashboard), **Writing Questions** (manage the
IELTS writing-question bank) and **Feedback** (read submissions from the in-app
feedback widget). The metrics view only ever surfaces counts and identities,
never any user's vocab or writing content.

## Who can see it

Only the owner/admin — the single privileged account, `isOwner(userId)` in `lib/auth/user.ts`
(today `DEV_USER_ID = "local-user"`, which the owner's Google sign-in reclaims). Non-owners get a
**403 — Not authorised** page. The link (🛠️ Admin) only shows in the nav for the owner, the page
is gated server-side (`force-dynamic`), and `GET /api/admin/stats` re-checks the owner independently
— defence in depth.

## What it shows

### Overview (metrics)

Everything is aggregated **in SQL** over the same libSQL DB (a private read-only client); the
window for time series is the last **30 days**. The dashboard is an operator's *"how is Lexi
doing?"* view — chart **form follows each metric's job** (the `dataviz` skill), rendered as
hand-authored inline SVG (no chart library) with Lexi's app tokens, so it matches `/report`. It
reuses the `/report` chart primitives (`components/report/Charts.tsx`:
`ActivityColumns`, `MasteryPipeline`, `HBars`) plus admin-only **count-scaled** primitives
(`components/admin/Charts.tsx`: `AreaTrend`, `CountColumns`, `MiniSpark`, `ResultMixBar`).

- **Pulse row** — four stat cards, each a big number + a mini sparkline + note: Users (+new in
  window), Active today (peak/day), Attempts (window + all-time), LLM units (window + today, with a
  week-over-week % change since spend is the metric to watch).
- **Answer quality** — the learning-health gauge: weighted accuracy across all learners (correct=1,
  partial=½, incorrect=0) with a week-over-week delta and the correct/almost/missed **status trio**
  (2px gaps + labelled legend — never colour-alone, matching `/report`).
- **Growth** — New signups (per-day **columns**) and User growth (cumulative registered users as an
  **area curve** — the right form for a running total, not bars).
- **Engagement** — Practice activity as **stacked result-mix columns** (correct/almost/missed per
  day) with a legend, Daily active users below it, and **Most active learners** (ranked by words
  studied), the list **paginated 10 per page**.
- **Vocabulary** — **Catalog mastery**: every studied word across all learners placed on the
  New → Known funnel (one part-to-whole bar, the emerald ordinal ramp), with the *Known %* headline.
- **LLM operations** — units today / window / all-time / tasks-tracked tiles, **Units over time**
  (area trend — is spend accelerating?), Usage by task (enrich, score, score-writing, extract-chart,
  discuss-writing, generate — ranked bars), and the heaviest consumers. Fed by the per-user daily
  quota log (`llm_usage`, `lib/auth/quota.ts`); every model-calling route requires sign-in and
  reserves a unit there, with caps set by the `QUOTA_*` env vars (see `.env.example`).

The stats endpoint (`AdminStats`, `lib/admin/stats.ts`) additionally computes the per-day result
mix + window overall bucket (`activity.byDay`/`activity.overall`), the catalog stage funnel
(`vocab.stageCounts`), and the daily LLM series + window total (`llm.daily`/`llm.windowTotal`) — all
cheap SQL aggregations, no raw content leaves the DB.

### Writing Questions

The **admin-managed bank** for IELTS Task 1 & Task 2 questions. Managing questions (create,
edit, delete, publish) is **admin-only and server-enforced** — regular learners can no longer
add or delete questions; the routes `POST /api/writing/prompts` and
`PATCH`/`DELETE /api/writing/prompts/:id` are all `withOwner`.

- **One combined list** of both tasks, with **keyword search** (title + question text), a
  **task filter** (Task 1 / Task 2), and a **publish-state filter** (Published / Draft).
- **Add** a question — choose Task 1 or Task 2, set the title, question text, optional model/
  sample answer, publish state, and (Task 1) a chart image whose numbers are read once by the
  vision LLM for grading ground truth.
- **Edit** any field of an existing question, including replacing/removing the chart image.
- **Publish / Unpublish** — reuses the prompt **`visibility`** concept (`public` = learners see
  it, `private` = a hidden draft). A newly added question defaults to Published.
- **Delete** — two-tap confirm; past learner submissions against it are kept.

The list comes from the owner-only `GET /api/admin/writing-prompts` (every prompt, both tasks,
drafts + published, no image bytes — each chart loads lazily from
`GET /api/writing/prompts/:id/image`). See `docs/features/writing-feedback.md` for how the bank
and visibility work end-to-end, and for the v2 adoption migration that pulled pre-existing
user-created prompts into the bank as drafts.

### Feedback

A **summary strip** (total submissions, average star rating, Bug and Idea counts — computed from
the loaded list) above a **read-only list** of every submission from the in-app floating feedback
widget, **newest first**, with a **category filter** (Bug / Idea / Other). Each row shows the
category, the 1–5 star rating (or "—" when unset), the message, and — for triage — who sent it
(email/name), when, and the page it was sent from. The list comes from the owner-only `GET /api/feedback`
(`withOwner` → 403 for anyone else). See `docs/features/feedback.md` for the widget, the
`feedback` table and the submit route.

---
*Under the hood: `app/(app)/admin/page.tsx` → `components/admin/AdminPortal.tsx` (tab shell);
Overview is `app/api/admin/stats/route.ts`, `lib/admin/*` (`stats.ts` computes `AdminStats`,
`aggregate.ts` shapes daily series, `paginate.ts` pages the users list),
`components/admin/AdminDashboard.tsx` + `components/admin/Charts.tsx` (admin-only SVG charts),
reusing `components/report/Charts.tsx` + `lib/report.ts` derivations; Writing Questions is `WritingQuestionsAdmin.tsx` +
`app/api/admin/writing-prompts/route.ts` and the `withOwner` writing-prompt routes; Feedback is
`components/admin/FeedbackAdmin.tsx` + the owner-only `GET /api/feedback`.*
