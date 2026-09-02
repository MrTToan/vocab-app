# Feedback

A lightweight way for signed-in learners to tell the owner what's working and
what isn't, without leaving the app — a **floating "💬 Feedback" button** on
every in-app page, and an owner-only **Feedback** subtab in the admin portal
that collects what people send.

## The widget

- A **fixed, bottom-right** button riding along on every signed-in app page
  (Practice, Library, Writing, Report, …) — mounted once by the `(app)` layout,
  so it's **never on the marketing landing page** (`/`), which has its own
  layout. It's shown only to signed-in users (its launcher is auth-gated) and,
  like the nav's Admin link, is rendered in a `<Suspense>` boundary so it never
  blocks the app shell from painting.
- Clicking it opens a small panel with **exactly three fields**:
  - **Category** — Bug / Idea / Other (defaults to **Other**).
  - **Rating** — an **optional** 1–5 star rating (click a chosen star again to
    clear it). Optional on purpose: someone with just a comment shouldn't be
    forced to pick stars.
  - **Message** — a required free-text box (up to **4,000** characters).
- **Submit** is disabled until there's a message. On success the panel shows a
  "Thanks for your feedback!" confirmation; on failure it shows the error and
  keeps the form so the user can retry.

## What's stored

Each submission is one row in the **`feedback`** table (created idempotently in
`migrate()`, `lib/db.ts`):

| column | notes |
| --- | --- |
| `id` | UUID |
| `user_id` | the signed-in submitter |
| `category` | `bug` / `idea` / `other` |
| `rating` | 1–5, or `NULL` when unset |
| `message` | the text |
| `page` | the in-app path it was sent from (e.g. `/practice`), for triage |
| `user_agent` | captured **server-side** from the request header (not client-supplied) |
| `created_at` | epoch ms |

Indexed on `created_at` (the admin list orders newest-first) and
`(user_id, created_at)`.

## The submit route

`POST /api/feedback` — sign-in gated (`withUser` → **401** when signed out),
origin-checked and body-size-capped by the shared wrapper (`lib/api.ts`), and
**zod-validated** (`createFeedbackSchema` in `lib/api-schemas.ts`): message
required and length-capped, category defaulted, rating optional 1–5, unknown
keys rejected. The route captures the User-Agent itself so the payload can't
spoof it.

## Reading feedback (admin)

`GET /api/feedback` is **owner-only** (`withOwner` → **403** for anyone else)
and returns every submission newest-first, joined with `users` for the
submitter's email/name. The admin **Feedback** subtab
(`components/admin/FeedbackAdmin.tsx`) renders it read-only with a category
filter — see `docs/features/admin.md`.

---
*Under the hood: `components/FeedbackWidget.tsx` (the widget) gated by
`app/(app)/FeedbackLauncher.tsx` and mounted in `app/(app)/layout.tsx`;
`lib/feedback/{types,store}.ts`; `app/api/feedback/route.ts`. Tests:
`tests/routes/feedback.test.ts` (auth/validation/write/admin-list),
`tests/components/feedback-widget.test.tsx` (widget), `tests/feedback-migration.test.ts`.*
