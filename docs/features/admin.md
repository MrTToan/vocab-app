# Admin portal (owner-only)

A read-only usage dashboard for the **site owner** at `/admin`. It's a metrics view, not a data
browser — it only ever surfaces counts and identities, never any user's vocab or writing content.

## Who can see it

Only the owner/admin — the single privileged account, `isOwner(userId)` in `lib/auth/user.ts`
(today `DEV_USER_ID = "local-user"`, which the owner's Google sign-in reclaims). Non-owners get a
**403 — Not authorised** page. The link (🛠️ Admin) only shows in the nav for the owner, the page
is gated server-side (`force-dynamic`), and `GET /api/admin/stats` re-checks the owner independently
— defence in depth.

## What it shows

Everything is aggregated **in SQL** over the same libSQL DB (a private read-only client); the
window for time series is the last **30 days**.

- **Overview tiles** — Users, New (30d), Words in catalog, Words studied (`user_words` rows),
  Distinct studied, Mastered (`stage = known`), Attempts, LLM units.
- **Users** — New signups per day, Cumulative users, and **Most active users** (ranked by words
  studied), the list **paginated 10 per page**.
- **Activity** — Attempts per day and Daily active users (distinct users with ≥1 attempt) — the
  v1 traffic signal, a free proxy with no page-view tracking.
- **LLM usage** — all-time units, today's units (UTC), usage by task, and the heaviest consumers.
  Fed by the per-user daily quota log (`llm_usage`, `lib/auth/quota.ts`).

> There is no standalone "Progress" chart — mastery appears only as the *Mastered* overview tile.

---
*Under the hood: `app/(app)/admin/page.tsx`, `app/api/admin/stats/route.ts`, `lib/admin/*`
(`stats.ts` computes `AdminStats`, `aggregate.ts` shapes daily series, `paginate.ts` pages the
users list), `components/admin/AdminDashboard.tsx`.*
