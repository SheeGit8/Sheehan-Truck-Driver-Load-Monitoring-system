# Sheehan Driver Load Monitoring

Web app for recording each driver phone's GOMO data balance, availed load and expiry, with
**2 screenshots from the GOMO app per phone per check**. A Google Sheet is the database and
screenshots are saved in a Google Drive folder. It runs as a Google Apps Script web app.

- **Overview**: latest status per phone, with low data (under 5 GB) and promos ending within 2 days flagged.
- **Load checks**: one check per date ("Updated by", then one row per phone). Add, edit and delete checks.
- **Drivers**: add newly hired drivers and their phones, edit details, or take a phone out of load checks.

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
4. Select the `setup` function and press **Run** once. Approve the permissions. It creates the
   `Drivers` and `Load Checks` sheets, the Drive folder `Sheehan Load Screenshots`, and the 9 current phones.
   Running it again is safe: it never overwrites rows.
5. **Deploy → New deployment → Web app**. Set *Execute as*: **Me** and *Who has access*: **only people in
   your organisation**, or specific accounts. Don't choose "Anyone": the app shows driver emails and SIM numbers.
6. Open the web app URL.

After changing the React code, run `npm run build:gas` and paste the new `apps-script/Index.html`
into the `Index` file again, then **Deploy → Manage deployments → Edit → New version**.

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

- Screenshots are resized to at most 1800 px on the long side and saved as JPEG (~200–350 KB each)
  before upload. They upload only when you press Save, so cancelling leaves no stray files.
  Replaced or removed screenshots go to the Drive trash (recoverable for 30 days).
- Account passwords, Messenger passwords and GOMO app PINs are **not** stored, as in the original `load.gs`:
  anyone who can open the web app can read what it stores.
- Thresholds live in `src/lib/format.js` (`LOW_DATA_GB = 5`, `EXPIRING_DAYS = 2`, `PROMO_DAYS = 7`).
