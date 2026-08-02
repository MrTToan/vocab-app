# Get an Anthropic API key

This unlocks **word enrichment** (meaning, examples, synonyms, usage traps) and
**sentence scoring** (write-a-sentence, translate, scenario). Without it, the app
still runs — flashcards, cloze, and type-the-word work — but those AI features are off.

Cost is tiny for this app: roughly **$2.50** to enrich ~500 words once, and
**~$2–3/month** of daily practice. See `TECH.md` for the full breakdown.

---

## Steps

1. Go to **https://console.anthropic.com** and sign in (or create an account).
2. Add a little credit: **Settings → Billing → Add credits** (even $5 lasts a long time).
   - New accounts sometimes have a small free trial credit — check Billing first.
3. Create the key: **Settings → API keys → Create Key**.
   - Give it a name like `lexi`.
   - **Copy it now** — it's shown only once. It looks like `sk-ant-api03-...`.
4. In the project folder, create your env file if you haven't:
   ```bash
   cp .env.example .env.local
   ```
5. Open `.env.local` and paste the key:
   ```
   ANTHROPIC_API_KEY=sk-ant-api03-xxxxxxxxxxxxxxxxxxxx
   ```
6. **Restart the dev server** (`Ctrl+C`, then `npm run dev`). Env changes only load on start.

---

## Verify it worked

- Open the app. The yellow "Setup" banner on the Home page should no longer mention
  a missing `ANTHROPIC_API_KEY`.
- Go to **Add**, type a word (e.g. `reluctant`), and click **Enrich →**. Within a
  couple seconds you should see meaning, examples, synonyms, etc. filled in.

If enrichment fails, check the terminal running `npm run dev` for the error.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Banner still says key missing | You didn't restart `npm run dev` after editing `.env.local`. |
| `authentication_error` / 401 | Key is wrong or has a stray space/newline. Re-copy it. |
| `credit balance is too low` | Add credits under **Billing**. |
| Nothing happens on "Enrich" | Open the browser console and the `npm run dev` terminal to see the error message. |

---

## Security

- `.env.local` is git-ignored — your key won't be committed. Keep it that way.
- The key is only used server-side (in API routes); it never reaches the browser.
- If a key ever leaks, revoke it in the Console (**API keys → ⋯ → Delete**) and make a new one.
