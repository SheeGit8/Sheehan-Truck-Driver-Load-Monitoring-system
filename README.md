# Sheehan Driver Load Monitoring

Web app for recording each driver phone's GOMO data balance, availed load and expiry, with
**2 screenshots from the GOMO app per phone per check**. A Google Sheet is the database and
screenshots are saved in a Google Drive folder. It runs as a Google Apps Script web app.

- **Overview**: latest status per phone, with low data (under 5 GB) and promos ending within 2 days flagged.
- **Load checks**: one check per date ("Updated by", then one row per phone). Add, edit and delete checks.
- **Drivers**: add newly hired drivers and their phones, edit details, or take a phone out of load checks.
- **Import**: bring the drivers and past load checks over from the old monitoring spreadsheet.
- **Request load**: phones with low data or an ending promo get a button that posts the screenshot to the
  HR group on Telegram. HR presses **Done loading** there, and the app shows the phone as loaded.

## Files

| Path | What it is |
| --- | --- |
| `apps-script/Code.gs` | Backend. Paste into the Apps Script project as `Code.gs`. |
| `api/gas.js`, `api/telegram.js` | Vercel functions: the app's link to the sheet, and the Telegram bot's webhook. |
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

## Load requests on Telegram

```
App "Request load" ──▶ Apps Script ──▶ Telegram HR group (screenshot + ✅ Done loading)
HR presses the button ──▶ Telegram ──▶ Vercel /api/telegram ──▶ Apps Script ──▶ "Load Requests" sheet
```

On **Overview**, a phone with low data (under 5 GB) or a promo that has ended or ends within 2 days shows
**Request load**. It sends the phone's latest reading, SIM number and both GOMO screenshots (as an album) to
the HR group, with the details and a **✅ Done loading** button right under the pictures. Every other phone
has **Send to Telegram**, which sends the same data for HR's information, without the button. The row then shows *Requested*. When someone in the group presses the button,
the Telegram message changes to *Loaded by …*, and the app shows *Loaded* until the next load check.
Every request is kept in the **Load Requests** sheet (who asked, when, who finished it).

This needs the Vercel setup above, because Telegram's button presses come in through `/api/telegram`.

1. In Telegram, open **@BotFather**, send `/newbot`, pick a name, and copy the **bot token**.
2. In `Code.gs` (Apps Script editor only, never on GitHub), fill in:
   - `TELEGRAM_BOT_TOKEN`: the token from step 1.
   - `APP_URL`: the Vercel address, e.g. `https://your-app.vercel.app`.
3. **Deploy → Manage deployments → Edit → New version**, and deploy Vercel with this version of the repo.
4. Select **`connectTelegram`** and press **Run**. Approve the new permission ("connect to an external
   service"). The log says which bot was connected.
5. Add the bot to the HR group chat and send **`/chatid`** in the group. The bot answers with a number like
   `-1001234567890`. Put it in `TELEGRAM_CHAT_ID` and deploy a new version again.
6. Optional: run **`testTelegram`** to send a test message to the group.

The button only works in that group. Each value can be kept in **Script Properties** (same names) instead of
`Code.gs`. If you change `SYNC_TOKEN`, run `connectTelegram` again, because the Telegram link is protected
with a secret made from it. In demo mode (`npm run dev`) nothing is sent: "HR" marks each request loaded
after 30 seconds so you can see the whole flow.

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

## The "Load Monitoring" tab (the old sheet's layout)

The app also keeps a **Load Monitoring** tab in the Google Sheet laid out like the old *SHEEHAN DRIVER LOAD
MONITORING* sheet: yellow title band, *PHONE SPECS & OTHERS*, the same columns A–S (Name … GOMO APP PIN), and an
*Updated By / Date* block per check (oldest at the top, 2 blank rows between checks) with one row per phone. Low data
(under 5 GB), promos ending within 2 days of the check, the availed load and the phone color are colored like before,
and BRAND / COLOR show as dropdowns. Remarks and the two screenshots follow after GOMO APP PIN.

- The two GOMO screenshots appear as **pictures inside the cells** (Screenshot 1 / Screenshot 2), not links. They
  shrink to fit their cell, so making a row or column bigger makes the picture bigger. Rows of checks with
  screenshots are 120 px tall (`MONITOR_IMAGE_ROW_HEIGHT` in `Code.gs`).
- It's rebuilt after every save, delete, driver change and import. Don't edit it by hand (it warns you): edits
  are replaced on the next save. `Drivers` and `Load Checks` stay the real data.
- **Password, Phone Model, Messenger Password and GOMO APP PIN** come from the columns of the same names at the end
  of the `Drivers` tab. Type them there, in the sheet. They are never sent to the web app, and saving a driver in
  the app keeps them as they are. Phone Model shows MODEL when left empty.
- Pictures use Drive's small thumbnail to keep the sheet light. Right after an upload Drive may not have one yet,
  so the full screenshot is shown until a later save swaps it in. At most 20 new screenshots are added per save;
  the rest follow on the next save.
- To build it now (e.g. the first time, with all past screenshots): run **`rebuildLoadMonitoring`** in the
  Apps Script editor, or **Load Monitor → Rebuild** in the sheet's menu bar. Run it again if the log says some
  screenshots are still to be added.

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
- Lists show each entry's screenshots as thumbnails that load by themselves (tap one for full size). They use
  Drive's small preview (`getScreenshotThumb` in `Code.gs`), only for rows on screen, 4 at a time. On phones they sit
  under the driver's name.
- Screenshots are resized to at most 1800 px on the long side and saved as JPEG (~200–350 KB each)
  before upload. They upload only when you press Save, so cancelling leaves no stray files.
  Replaced or removed screenshots go to the Drive trash (recoverable for 30 days).
- Account passwords, Messenger passwords and GOMO app PINs **never go through the web app**, as in the original
  `load.gs`: anyone who can open the web app can read what it returns. They live only in the sheet (`Drivers` tab,
  shown on `Load Monitoring`), so only people the sheet is shared with can see them.
- **Data versions** keep several people (or the app and someone editing the sheet directly) from
  overwriting each other. `getAppData()` returns a `dataVersion` for all data plus a `version` on every
  check and driver, each a short hash of the sheet rows. An open page calls `getDataVersion()` every
  45 seconds and when the tab comes back into view. If the data changed, it reloads (or, in the load check editor,
  shows a notice). Every save and delete sends the version it started from. If those rows changed meanwhile,
  the backend refuses the change with a `CONFLICT:` error and the app offers to reload or, for a
  load check, to save anyway. Nothing extra is stored in the sheet.
- Thresholds live in `src/lib/format.js` (`LOW_DATA_GB = 5`, `EXPIRING_DAYS = 2`, `PROMO_DAYS = 7`).
