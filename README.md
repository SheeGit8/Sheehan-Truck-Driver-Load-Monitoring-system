# Sheehan Driver Load Monitoring

Web app for recording each driver phone's GOMO data balance, availed load and expiry, with
**2 screenshots from the GOMO app per phone per check**. A Google Sheet is the database and
screenshots are saved in a Google Drive folder. It runs as a Google Apps Script web app.

- **Overview**: latest status per phone, with low data (under 5 GB) and promos ending within 2 days flagged.
- **Load checks**: one check per date ("Updated by", then one row per phone). Add, edit and delete checks.
- **Drivers**: add newly hired drivers and their phones, edit details, or take a phone out of load checks.
- **Import**: bring the drivers and past load checks over from the old monitoring spreadsheet.

## Files

| Path | What it is |
| --- | --- |
| `apps-script/Code.gs` | Backend. Paste into the Apps Script project as `Code.gs`. |
| `apps-script/Index.html` | The whole frontend in one file, built by `npm run build:gas`. Paste as `Index.html`. |
| `src/` | React source for the frontend. |
| `src/reference/load.gs` | Original backend this was based on (1 screenshot per entry). Kept for reference only. |

## Deploy to Google Sheets

1. Open the Google Sheet, then **Extensions → Apps Script**.
2. Replace the contents of `Code.gs` with `apps-script/Code.gs`.
3. **File → New → HTML file**, name it `Index`, and paste in `apps-script/Index.html`.
4. Select the `setup` function and press **Run** once. Approve the permissions. It creates the empty
   `Drivers` and `Load Checks` sheets (headers only) and the Drive folder `Sheehan Load Screenshots`.
   Running it again is safe: it never touches existing rows. Add the phones in the app under **Drivers**.
   To start over later, run `clearAllData` (deletes every driver and check row, keeps the headers).
5. **Deploy → New deployment → Web app**. Set *Execute as*: **Me** and *Who has access*: **only people in
   your organisation**, or specific accounts. Don't choose "Anyone": the app shows driver emails and SIM numbers.
6. Open the web app URL.

After changing the React code, run `npm run build:gas` and paste the new `apps-script/Index.html`
into the `Index` file again, then **Deploy → Manage deployments → Edit → New version**.

## Host on Vercel (with a sync token)

```
Browser ──app password──▶ Vercel /api/gas ──sync token──▶ Apps Script (doPost) ──▶ Sheet + Drive
```

The sync token is the secret that lets Vercel read and write the sheet. It lives only in Apps Script and
in Vercel's server settings, never in the page. People open the app with a separate **app password**.

**1. Apps Script** (in the Google Sheet: **Extensions → Apps Script**)

1. Paste `apps-script/Code.gs` into `Code.gs`. The `Index` HTML file isn't needed for Vercel.
2. Fill in the two settings at the top of `Code.gs`, **in the Apps Script editor only** (this repo is public):
   - `SYNC_TOKEN`: a long random secret, the same value you give Vercel. Or leave it `''` and run
     **`generateSyncToken`**, which saves one in Script Properties and prints it in the **Execution log**.
   - `SPREADSHEET_URL`: the sheet's link. Can stay `''` when the script was opened from the sheet.

   `apps-script/*.private.gs` is git-ignored, so a filled-in copy such as `apps-script/Code.private.gs` can be
   kept locally.
3. Run `setup` once and approve the permissions.
4. **Deploy → New deployment → Web app**: *Execute as* **Me**, *Who has access* **Anyone**.
   Copy the web app URL ending in `/exec`. That's your `GAS_URL`. Opening it should show
   *"Sheehan Load Monitor API is running"*.
   "Anyone" is needed because Vercel can't sign in to Google. The URL still refuses every request without the
   sync token. Once a sync token exists, the built-in page is switched off.

**2. Vercel**

1. **Add New → Project** and import this GitHub repo. Leave **Root Directory** as `./`.
   Framework, build command and output folder come from `vercel.json`.
2. **Settings → Environment Variables** (see `.env.example`):

   | Name | Value |
   | --- | --- |
   | `GAS_URL` | the `/exec` URL from step 1.4 |
   | `SYNC_TOKEN` | the token from step 1.2 |
   | `APP_PASSWORD` | a long password you give to the people who record loads |

   Don't prefix them with `VITE_`. That would put them inside the page.
3. Deploy, then open the site and enter the app password. It's remembered on that device until
   **Sign out on this device** in the footer.

**Changing things later**

- New sync token: change `SYNC_TOKEN` in `Code.gs` (or run `generateSyncToken` again) and deploy a new version,
  then update `SYNC_TOKEN` in Vercel and redeploy. The old one stops working at once.
- New app password: change `APP_PASSWORD` in Vercel and redeploy. Everyone is asked again.
- After editing `Code.gs`: **Deploy → Manage deployments → Edit → New version**, so the `/exec` URL stays the same.
- Back to the Google-hosted page: empty `SYNC_TOKEN` in `Code.gs`, run `removeSyncToken`, deploy a new version,
  then set access back to your organisation.
- *"Google Sheets did not answer"* in the app: open the `GAS_URL` link. If it shows a Google error page,
  the deployment runs old code: **Deploy → Manage deployments → ✏️ → Version: New version → Deploy**.

## Import from the old spreadsheet

**Import** (on Load checks, Drivers, or the empty Overview) reads the old *SHEEHAN DRIVER LOAD MONITORING* sheet:

1. In the old sheet, **File → Download → Comma-separated values (.csv)**, then choose that file.
   Or select everything (the box left of column A), copy, and paste it into the dialog.
2. Check the preview (dates, phones per check, drivers), then press **Import**.

It understands the old layout (a header row with Name, USER, Current Data, Availed Load, Exp. Date, Exp. Time…,
then "Updated By / Date" blocks with one row per phone) and also tables with a Date column on every row, such as a
`Load Checks` tab. Notes typed in the unlabeled column after the last header become remarks.

- Only adds. Drivers already in the app (same account name, email or serial #) are kept as they are, and dates that
  already have a load check are skipped, so importing the same file twice changes nothing.
- Password, Messenger password and GOMO app PIN columns are never read.
- Everything is written in one request (`importData` in `Code.gs`), so the Code.gs in Apps Script must be the
  current one: paste it and deploy a new version before the first import.

### Upgrading a sheet made with the old `load.gs`

Nothing to migrate. The first time the new code runs, it adds the
`Screenshot 2 File ID` and `Screenshot 2 Link` columns to the end of `Load Checks`.

## Local development

```bash
npm install
npm run dev
```

Outside Apps Script the app uses **demo data** kept in your browser, seeded from the Nov 10 and Nov 18, 2026
checks (a "Demo data" badge shows in the header). Use "Reset demo data" in the footer to start over.

## Notes

- On a phone, each screenshot slot shows **Camera** (opens the back camera) and **Gallery** (pick an existing
  screenshot or photo). On a computer you click, drag in, or paste an image.
- Screenshots are resized to at most 1800 px on the long side and saved as JPEG (~200–350 KB each)
  before upload. They upload only when you press Save, so cancelling leaves no stray files.
  Replaced or removed screenshots go to the Drive trash (recoverable for 30 days).
- Account passwords, Messenger passwords and GOMO app PINs are **not** stored, as in the original `load.gs`:
  anyone who can open the web app can read what it stores.
- **Data versions** keep several people (or the app and someone editing the sheet directly) from
  overwriting each other. `getAppData()` returns a `dataVersion` for all data plus a `version` on every
  check and driver, each a short hash of the sheet rows. An open page calls `getDataVersion()` every
  45 seconds and when the tab comes back into view. If the data changed, it reloads (or, in the load check editor,
  shows a notice). Every save and delete sends the version it started from. If those rows changed meanwhile,
  the backend refuses the change with a `CONFLICT:` error and the app offers to reload or, for a
  load check, to save anyway. Nothing extra is stored in the sheet.
- Thresholds live in `src/lib/format.js` (`LOW_DATA_GB = 5`, `EXPIRING_DAYS = 2`, `PROMO_DAYS = 7`).
