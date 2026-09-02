# Admin portal (owner-only)

The **site owner**'s portal at `/admin`, a tabbed surface with two subtabs:
**Overview** (a read-only usage dashboard) and **Writing Questions** (manage the
IELTS writing-question bank). The metrics view only ever surfaces counts and
identities, never any user's vocab or writing content.

## Who can see it

Only the owner/admin — the single privileged account, `isOwner(userId)` in `lib/auth/user.ts`
(today `DEV_USER_ID = "local-user"`, which the owner's Google sign-in reclaims). Non-owners get a
**403 — Not authorised** page. The link (🛠️ Admin) only shows in the nav for the owner, the page
is gated server-side (`force-dynamic`), and `GET /api/admin/stats` re-checks the owner independently
— defence in depth.

## What it shows

### Overview (metrics)

Everything is aggregated **in SQL** over the same libSQL DB (a private read-only client); the
window for time series is the last **30 days**.

- **Overview tiles** — Users, New (30d), Words in catalog, Words studied (`user_words` rows),
  Distinct studied, Mastered (`stage = known`), Attempts, LLM units.
- **Users** — New signups per day, Cumulative users, and **Most active users** (ranked by words
  studied), the list **paginated 10 per page**.
- **Activity** — Attempts per day and Daily active users (distinct users with ≥1 attempt) — the
  v1 traffic signal, a free proxy with no page-view tracking.
- **LLM usage** — all-time units, today's units (UTC), usage by task (enrich, score, score-writing,
  extract-chart, discuss-writing, generate), and the heaviest consumers. Fed by the per-user daily
  quota log (`llm_usage`, `lib/auth/quota.ts`); every model-calling route requires sign-in and
  reserves a unit there, with caps set by the `QUOTA_*` env vars (see `.env.example`).

> There is no standalone "Progress" chart — mastery appears only as the *Mastered* overview tile.

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

---
*Under the hood: `app/(app)/admin/page.tsx` → `components/admin/AdminPortal.tsx` (tab shell);
Overview is `app/api/admin/stats/route.ts`, `lib/admin/*` (`stats.ts` computes `AdminStats`,
`aggregate.ts` shapes daily series, `paginate.ts` pages the users list),
`components/admin/AdminDashboard.tsx`; Writing Questions is `WritingQuestionsAdmin.tsx` +
`app/api/admin/writing-prompts/route.ts` and the `withOwner` writing-prompt routes.*
