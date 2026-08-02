# Store your words in a Google Sheet (free)

By default the app saves words to a local file (`.data/words.json`). Do this setup to
sync them to a Google Sheet instead — so you can open, read, edit, and back up your
vocabulary in a familiar spreadsheet.

**Cost: $0.** No billing account or credit card is required for the Google Sheets API.

**How it works:** you create a free "service account" — a robot Google identity with its
own email — and *share your Sheet with it* (like sharing a doc with a person). The app
signs in as that robot. Your data still lives in **your** Google Drive.

Total time: ~5 minutes. You'll end up with three values in `.env.local`:
`GOOGLE_SERVICE_ACCOUNT_JSON`, `SHEET_ID` (and nothing else).

---

## Part A — Create a project & turn on the Sheets API

1. Go to **https://console.cloud.google.com** and sign in with your Google account.
2. In the top bar, click the **project dropdown → New Project**.
   - Name it `lexi` → **Create**. Wait a few seconds, then make sure it's selected in
     the dropdown.
3. Enable the Sheets API for that project: open
   **https://console.cloud.google.com/apis/library/sheets.googleapis.com**
   → click **Enable**.
   - (If it asks you to pick a project, pick `lexi`.)

---

## Part B — Create the service account & download its key

1. Go to **APIs & Services → Credentials**:
   **https://console.cloud.google.com/apis/credentials**
2. **+ Create Credentials → Service account**.
   - Name: `lexi-bot` → **Create and continue**.
   - Skip the optional "grant access" steps → **Done**.
3. You're back on the Credentials page. Under **Service Accounts**, click **`lexi-bot`**.
4. Open the **Keys** tab → **Add key → Create new key → JSON → Create**.
   - A `.json` file downloads to your computer. **Treat it like a password.**
5. Note the service account's email — it's the `client_email` inside the JSON, and also
   shown on the service-account page. It looks like:
   `lexi-bot@lexi-123456.iam.gserviceaccount.com`

---

## Part C — Create the Sheet & share it with the robot

1. Create a new blank sheet: **https://sheets.new**. Name it anything (e.g. "Lexi words").
   - Don't add any columns — the app creates a `Words` tab with headers automatically.
2. Copy the **Sheet ID** from the URL. In
   `https://docs.google.com/spreadsheets/d/`**`1AbCd...XyZ`**`/edit`
   the ID is the bold middle part.
3. Click **Share** (top-right). Paste the service account's `client_email` from Part B,
   set it to **Editor**, untick "Notify people", and **Share**.

---

## Part D — Put the values in `.env.local`

1. Open the downloaded JSON key in a text editor. Select **all of it** and copy.
2. In `.env.local`, paste it as a **single line** (it's already valid JSON):
   ```
   GOOGLE_SERVICE_ACCOUNT_JSON={"type":"service_account","project_id":"lexi-...","private_key_id":"...","private_key":"-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n","client_email":"lexi-bot@lexi-...iam.gserviceaccount.com", ...}
   ```
   - Keep the whole thing on one line. Don't remove the `\n` sequences inside `private_key`.
3. Add the Sheet ID:
   ```
   SHEET_ID=1AbCd...XyZ
   ```
4. **Restart** the dev server (`Ctrl+C`, then `npm run dev`).

---

## Verify it worked

- On the Home page, the "Setup" banner should no longer mention local storage.
- Add a word in the app, then open your Google Sheet — a **`Words`** tab should appear
  with your word as a row.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| App still shows "local" storage | Restart `npm run dev`. Both `SHEET_ID` **and** the credentials must be set. |
| `The caller does not have permission` | You didn't share the Sheet with the service account's `client_email` (Part C.3), or gave it Viewer not Editor. |
| `Requested entity was not found` | `SHEET_ID` is wrong — re-copy just the middle part of the Sheet URL. |
| `error:0909006C` / PEM / "invalid key" | The `private_key`'s `\n` got mangled. Re-paste the JSON exactly as downloaded, on one line. |
| `Google Sheets API has not been used` | Part A.3 — enable the Sheets API for the `lexi` project. |

### Alternative to pasting the whole JSON
Instead of `GOOGLE_SERVICE_ACCOUNT_JSON`, you can set two vars (from the same JSON file):
```
GOOGLE_SERVICE_ACCOUNT_EMAIL=lexi-bot@lexi-...iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```
Keep the quotes and the literal `\n`.

---

## Notes

- The `.json` key file stays on your machine; `.env.local` is git-ignored. Neither is committed.
- Your words live in your own Drive. To revoke access later, remove the robot from the
  Sheet's Share list, or delete the key in the Cloud Console.
- Want to move words already saved locally into the Sheet? Ask and I'll add a one-click migration.
