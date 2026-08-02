# Setup — Lexi

The app runs immediately with **zero setup** (it stores words in a local file and
skips AI). Add the two things below to unlock the full experience.

## 0. Run it

```bash
npm run dev
```

Open http://localhost:3000 (it may use **3001** if 3000 is busy — watch the
terminal). You can add words and practise right away. Without an API key there's no
auto-enrichment or sentence scoring; words are stored in a local **SQLite** database
(`.data/lexi.db`) by default — fast and zero-setup.

Create your env file:

```bash
cp .env.example .env.local
```

Then fill in the pieces below and restart `npm run dev`.

---

## 1. Anthropic API key (enrichment + scoring)

Full step-by-step, with verification and troubleshooting:
**[`docs/SETUP-ANTHROPIC.md`](docs/SETUP-ANTHROPIC.md)**

In short: get a key at https://console.anthropic.com, add it to `.env.local` as
`ANTHROPIC_API_KEY=...`, and restart `npm run dev`.

---

## 2. Storage (optional)

By **default** the app uses a local **SQLite** database (`.data/lexi.db`) — fast, and
nothing to set up. To deploy on serverless later, point it at a free hosted libSQL
(Turso) with `DATABASE_URL` / `DATABASE_AUTH_TOKEN` (see `.env.example`).

**Prefer a spreadsheet instead?** You can use a **Google Sheet** so you can open/edit
your words there. Full step-by-step:
**[`docs/SETUP-GOOGLE-SHEET.md`](docs/SETUP-GOOGLE-SHEET.md)**

In short: create a free Google service account, download its JSON key, create a Sheet
and share it with the service account's email, then put `GOOGLE_SERVICE_ACCOUNT_JSON`
and `SHEET_ID` in `.env.local` and restart. Your words then live in your own Sheet.

---

## Deploy later (optional)

When you want it on your phone: push to GitHub, import into **Vercel**, and paste
the same env vars into Vercel's project settings. We'll add a simple password at
that point so it isn't public.
