/**
 * Sheehan Driver Load Monitoring — Apps Script backend
 *
 * How to install (details in README.md):
 *   1. Open the Google Sheet > Extensions > Apps Script.
 *   2. Paste this file into Code.gs, and add an HTML file named "Index" with the contents of
 *      apps-script/Index.html (made by `npm run build:gas` in the load-monitor project).
 *   3. Pick `setup` in the function list and press Run once (it creates the empty sheets
 *      and the screenshot folder). Add drivers in the app under Drivers.
 *   4. Deploy > New deployment > Web app.
 *
 * Hosting the app on Vercel instead (details in README.md):
 *   - Put the sync token in SYNC_TOKEN at the top of this file (or run `generateSyncToken` once,
 *     which saves one in Script Properties and prints it in the execution log).
 *   - Deploy as a web app with Execute as: Me, Who has access: Anyone.
 *   - In Vercel, set GAS_URL (the web app URL), SYNC_TOKEN and APP_PASSWORD.
 *   The Vercel server sends the sync token with every request (doPost below); requests without
 *   it are refused. Once a sync token exists, the built-in page (doGet) is switched off so the
 *   "Anyone" link doesn't expose the data.
 *
 * Sheets used:
 *   "Drivers"      one row per phone / driver account
 *   "Load Checks"  one row per driver per check date
 *   "Load Monitoring"  the old SHEEHAN DRIVER LOAD MONITORING layout (an "Updated By / Date" block per
 *                  check), rebuilt from the two sheets above after every save. Screenshots show as
 *                  pictures inside the cells and resize with them. Read-only: edits there are replaced.
 *   "Load Requests" one row per "Request load" sent to the HR group on Telegram (see TELEGRAM below)
 * Each load check entry can carry 2 screenshots from the GOMO app. They are saved as
 * image files in the Drive folder "Sheehan Load Screenshots".
 *
 * Data versions: getAppData() returns a `dataVersion` for the whole data set, plus a `version` on
 * every check and driver. Each is a short hash of the rows behind it, so it also changes when
 * someone edits the sheet by hand. The web app polls getDataVersion() to notice changes, and sends
 * the version it last saw with every save. If the rows changed in the meantime, the save is refused
 * with a message starting "CONFLICT:" instead of overwriting the other person's work.
 *
 * Account passwords, Messenger passwords and GOMO app PINs never go through the web app, because
 * everyone who can open it can read what it returns. They can be typed into the "Drivers" tab of the
 * sheet (columns Password, Messenger Password, GOMO App PIN) and then show only in "Load Monitoring".
 */

/* ================================================================== */
/* YOUR SETTINGS: fill these in inside the Apps Script editor.         */
/* Don't commit the filled-in values to GitHub (the repo is public).   */
/* ================================================================== */

/** Same value as SYNC_TOKEN in Vercel > Settings > Environment Variables. */
const SYNC_TOKEN = '';

/**
 * Link to the Google Sheet used as the database, e.g.
 * 'https://docs.google.com/spreadsheets/d/1AbC...xyz/edit'
 * Can stay '' when this script was opened from the sheet (Extensions > Apps Script).
 */
const SPREADSHEET_URL = '';

/*
 * TELEGRAM: "Request load" in the app posts the driver's low-load screenshot to the HR group chat,
 * with a "Done loading" button HR presses once the phone is loaded. Setup (details in README.md):
 *   1. In Telegram, talk to @BotFather, send /newbot and copy the bot token into TELEGRAM_BOT_TOKEN.
 *   2. Put the Vercel app address into APP_URL, deploy a new version, then run connectTelegram once.
 *   3. Add the bot to the HR group and send /chatid there. Copy the number it answers with
 *      into TELEGRAM_CHAT_ID and deploy a new version.
 * Each value can also be kept in Script Properties under the same name instead.
 */

/** Bot token from @BotFather, like '123456789:AAE...'. Secret: anyone with it controls the bot. */
const TELEGRAM_BOT_TOKEN = '';

/** The HR group's chat id, a negative number like '-1001234567890' (send /chatid in the group). */
const TELEGRAM_CHAT_ID = '';

/** The Vercel app address, e.g. 'https://sheehan-load-monitor.vercel.app'. Used by connectTelegram. */
const APP_URL = '';

/* ================================================================== */

const CONFIG = {
  DRIVERS_SHEET: 'Drivers',
  CHECKS_SHEET: 'Load Checks',
  REQUESTS_SHEET: 'Load Requests',
  REQUESTS_IN_APP: 300,            // newest load requests sent to the web app
  SCREENSHOT_FOLDER_NAME: 'Sheehan Load Screenshots',
  FOLDER_PROPERTY: 'SCREENSHOT_FOLDER_ID',
  SYNC_TOKEN_PROPERTY: 'SYNC_TOKEN',
  SPREADSHEET_PROPERTY: 'SPREADSHEET_URL', // optional, see spreadsheet_()
  HEADER_BG: '#C8102E',
  HEADER_FG: '#FFFFFF',
  MAX_UPLOAD_CHARS: 12 * 1024 * 1024, // ~9 MB image after base64

  // "Load Monitoring" tab (copy of the old monitoring sheet)
  MONITOR_SHEET: 'Load Monitoring',
  MONITOR_IMAGE_ROW_HEIGHT: 120,   // row height (px) for checks with screenshots; images shrink to fit
  MONITOR_IMAGES_PER_SAVE: 20,     // new screenshots fetched per save; the rest follow on the next save
  MONITOR_IMAGES_PER_RUN: 250,     // same, when rebuildLoadMonitoring is run by hand
  MONITOR_MAX_IMAGE_BYTES: 1500000, // full-size fallback limit while Drive has no thumbnail yet
  LOW_DATA_GB: 5,                  // Current Data below this turns red (same as the app)
  EXPIRING_DAYS: 2,                // Exp. Date within this many days of the check turns red

  // Automatic load requests: after a load check is saved, every phone under LOW_DATA_GB gets a load
  // request on Telegram by itself, the same as pressing "Request load" (see autoRequestLoads).
  AUTO_REQUEST_LOW_DATA: true,     // false: only the "Request load" button sends requests
  AUTO_REQUEST_SECONDS: 25,        // time per call before the app is told to call again for the rest
};

const DRIVER_FIELDS = [
  ['id', 'ID'],
  ['label', 'Account Name'],
  ['user', 'Assigned Driver'],
  ['surname', 'Surname'],
  ['email', 'Driver Email'],
  ['birthday', 'Birthday'],
  ['recoveryEmail', 'Recovery Email'],
  ['brand', 'Brand'],
  ['model', 'Model'],
  ['color', 'Color'],
  ['serial', 'Serial #'],
  ['sim', 'GOMO SIM #'],
  ['active', 'In Load Checks'],
  ['sort', 'Sort'],
  // Sheet-only columns (see SHEET_ONLY_DRIVER_KEYS). Kept at the end so older sheets stay compatible.
  ['phoneModel', 'Phone Model'],
  ['password', 'Password'],
  ['messengerPassword', 'Messenger Password'],
  ['appPin', 'GOMO App PIN'],
];

/**
 * Driver columns that live only in the sheet: typed into the "Drivers" tab and shown on "Load Monitoring",
 * but never sent to the web app (getAppData leaves them out) and never changed by it (saveDriver keeps them).
 */
const SHEET_ONLY_DRIVER_KEYS = ['phoneModel', 'password', 'messengerPassword', 'appPin'];

const CHECK_FIELDS = [
  ['date', 'Date'],
  ['updatedBy', 'Updated By'],
  ['driverId', 'Driver ID'],
  ['driverLabel', 'Account Name'],
  ['driverName', 'Assigned Driver'],
  ['currentData', 'Current Data (GB)'],
  ['load', 'Availed Load'],
  ['expDate', 'Exp. Date'],
  ['expTime', 'Exp. Time'],
  ['remarks', 'Remarks'],
  ['screenshotId', 'Screenshot 1 File ID'],
  ['screenshotUrl', 'Screenshot 1 Link'],
  ['savedAt', 'Saved At'],
  // Added for the second GOMO screenshot. Kept at the end so older sheets stay compatible.
  ['screenshot2Id', 'Screenshot 2 File ID'],
  ['screenshot2Url', 'Screenshot 2 Link'],
];

const REQUEST_FIELDS = [
  ['id', 'Request ID'],
  ['requestedAt', 'Requested At'],
  ['requestedBy', 'Requested By'],
  ['driverId', 'Driver ID'],
  ['driverLabel', 'Account Name'],
  ['driverName', 'Assigned Driver'],
  ['sim', 'GOMO SIM #'],
  ['currentData', 'Current Data (GB)'],
  ['load', 'Availed Load'],
  ['expires', 'Expires'],
  ['checkDate', 'Check Date'],
  ['screenshotId', 'Screenshot File ID'],
  ['note', 'Note'],
  ['status', 'Status'],          // Requested | Done
  ['doneAt', 'Done At'],
  ['doneBy', 'Done By'],
  ['telegramMessageId', 'Telegram Message ID'],
  ['screenshot2Id', 'Screenshot 2 File ID'],
];

const ENTRY_KEYS = ['driverId', 'currentData', 'load', 'expDate', 'expTime', 'remarks', 'screenshotId', 'screenshot2Id'];

/* ------------------------------------------------------------------ */
/* Web app entry                                                       */
/* ------------------------------------------------------------------ */

function doGet() {
  if (syncToken_()) {
    // Vercel mode: the deployment is open to "Anyone", so don't serve the app (and with it
    // google.script.run access) from here. The app lives on Vercel and talks to doPost.
    return ContentService.createTextOutput('Sheehan Load Monitor API is running. Open the app on Vercel.');
  }
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Sheehan Driver Load Monitoring')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/* ------------------------------------------------------------------ */
/* Sync token: lets the Vercel app read and write this sheet           */
/* ------------------------------------------------------------------ */

/**
 * Run from the editor to create (or replace) the sync token. Copy the value from the execution
 * log into Vercel as SYNC_TOKEN. Running it again invalidates the old token.
 */
function generateSyncToken() {
  const token = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  PropertiesService.getScriptProperties().setProperty(CONFIG.SYNC_TOKEN_PROPERTY, token);
  Logger.log('SYNC_TOKEN (paste into Vercel > Settings > Environment Variables):\n' + token);
  if (SYNC_TOKEN) Logger.log('Note: SYNC_TOKEN at the top of Code.gs is filled in, so that one is used instead of this one.');
  return token;
}

/** Run from the editor to switch Vercel access off and bring back the built-in page. */
function removeSyncToken() {
  PropertiesService.getScriptProperties().deleteProperty(CONFIG.SYNC_TOKEN_PROPERTY);
  Logger.log(SYNC_TOKEN
    ? 'Script Property removed, but SYNC_TOKEN at the top of Code.gs is still filled in. Empty it too.'
    : 'Sync token removed. Vercel can no longer reach this sheet.');
}

/**
 * The spreadsheet used as the database: SPREADSHEET_URL at the top of this file, else the
 * Script Property SPREADSHEET_URL, else the sheet this script was opened from.
 */
function spreadsheet_() {
  const setting = String(SPREADSHEET_URL || '').trim() ||
    PropertiesService.getScriptProperties().getProperty(CONFIG.SPREADSHEET_PROPERTY);
  if (setting) {
    const m = /\/d\/([\w-]{20,})/.exec(setting);
    return SpreadsheetApp.openById(m ? m[1] : setting.trim());
  }
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (!active) {
    throw new Error('No spreadsheet linked. Paste the sheet\'s link into SPREADSHEET_URL at the top of Code.gs ' +
      'and deploy a new version.');
  }
  return active;
}

/** SYNC_TOKEN at the top of this file, else the one made by generateSyncToken. */
function syncToken_() {
  return String(SYNC_TOKEN || '').trim() ||
    PropertiesService.getScriptProperties().getProperty(CONFIG.SYNC_TOKEN_PROPERTY) || '';
}

/** Functions the Vercel app may call. Anything else is refused. */
const REMOTE_API_ = {
  getAppData: getAppData,
  getDataVersion: getDataVersion,
  saveCheck: saveCheck,
  deleteCheck: deleteCheck,
  saveDriver: saveDriver,
  importData: importData,
  uploadScreenshot: uploadScreenshot,
  getScreenshot: getScreenshot,
  getScreenshotThumb: getScreenshotThumb,
  removeScreenshot: removeScreenshot,
  requestLoad: requestLoad,
  autoRequestLoads: autoRequestLoads,
  telegramUpdate: telegramUpdate, // called by the Vercel Telegram webhook (api/telegram.js) only
};

/**
 * JSON API used by the Vercel server (api/gas.js).
 * Request body: {"token": "<sync token>", "fn": "getAppData", "args": []}
 * Response: {"ok": true, "result": ...} or {"ok": false, "error": "...", "status": 401|400|503}
 */
function doPost(e) {
  let out;
  try {
    const expected = syncToken_();
    if (!expected) throw httpError_(503, 'No sync token yet. Run generateSyncToken in the Apps Script editor.');
    let req;
    try {
      req = JSON.parse((e && e.postData && e.postData.contents) || '');
    } catch (err) {
      throw httpError_(400, 'The request body is not JSON.');
    }
    if (!sameText_(String(req.token || ''), expected)) throw httpError_(401, 'Wrong sync token.');
    const fn = Object.prototype.hasOwnProperty.call(REMOTE_API_, req.fn) ? REMOTE_API_[req.fn] : null;
    if (!fn) throw httpError_(400, 'Unknown function: ' + req.fn);
    out = { ok: true, result: fn.apply(null, Array.isArray(req.args) ? req.args : []) };
  } catch (err) {
    out = { ok: false, error: err && err.message ? err.message : String(err), status: (err && err.status) || 400 };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function httpError_(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/** Compares two strings without stopping at the first difference. */
function sameText_(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Run once from the editor. Creates the empty "Drivers" and "Load Checks" sheets (headers only)
 * and the screenshot folder. Safe to run again: it never touches existing rows.
 * Running it is optional: the sheets are also created the first time the app loads.
 */
function setup() {
  driversSheet_();
  checksSheet_();
  requestsSheet_();
  const folder = screenshotFolder_();
  withLock_(function () { refreshMonitorSheet_(CONFIG.MONITOR_IMAGES_PER_RUN, true); });
  Logger.log('Setup complete. Spreadsheet: ' + spreadsheet_().getUrl() + '\nScreenshots folder: ' + folder.getUrl());
}

/**
 * Run from the editor to start over: deletes every driver and load check row (headers stay).
 * Cannot be undone from the app; use File > Version history in the sheet to get rows back.
 * Screenshot files stay in the Drive folder.
 */
function clearAllData() {
  withLock_(function () {
    [driversSheet_(), checksSheet_()].forEach(function (sh) {
      if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).clearContent();
    });
    SpreadsheetApp.flush();
    refreshMonitorSheetSafe_();
  });
  Logger.log('All drivers and load checks deleted. Add drivers in the app under Drivers.');
}

/* ------------------------------------------------------------------ */
/* API called from Index.html with google.script.run                   */
/* ------------------------------------------------------------------ */

function getAppData() {
  const driverRows = readObjects_(driversSheet_(), DRIVER_FIELDS);
  const checkRows = readObjects_(checksSheet_(), CHECK_FIELDS);

  const drivers = driverRows
    .map(function (r) {
      const d = cleanDriver_(r);
      d.version = driverVersion_(r);
      return d;
    })
    .sort(function (a, b) { return a.sort - b.sort; });

  const byDate = {};
  checkRows.forEach(function (row) {
    const date = String(row.date);
    if (!date) return;
    if (!byDate[date]) byDate[date] = { date: date, updatedBy: '', entries: [] };
    if (row.updatedBy) byDate[date].updatedBy = String(row.updatedBy);
    const entry = {};
    ENTRY_KEYS.forEach(function (k) { entry[k] = row[k] === undefined ? '' : String(row[k]); });
    byDate[date].entries.push(entry);
  });

  const checks = Object.keys(byDate)
    .sort(function (a, b) { return b.localeCompare(a); })
    .map(function (d) {
      byDate[d].version = checkVersion_(checkRows, d);
      return byDate[d];
    });

  const requestRows = readObjects_(requestsSheet_(), REQUEST_FIELDS);
  const requests = requestRows.slice(-CONFIG.REQUESTS_IN_APP).reverse().map(cleanRequest_);

  return {
    drivers: drivers,
    checks: checks,
    requests: requests,
    telegram: !!(telegramToken_() && telegramChatId_()),
    dataVersion: dataVersion_(driverRows, checkRows, requestRows),
  };
}

/** Cheap poll: the current data version, so the web app can tell whether anything changed. */
function getDataVersion() {
  return dataVersion_(
    readObjects_(driversSheet_(), DRIVER_FIELDS),
    readObjects_(checksSheet_(), CHECK_FIELDS),
    readObjects_(requestsSheet_(), REQUEST_FIELDS));
}

/**
 * Creates or updates every row of one check (one date).
 * baseVersion: the check's `version` from getAppData ('' for a new check). null overwrites without checking.
 */
function saveCheck(check, baseVersion) {
  if (!check || !isIsoDate_(check.date)) throw new Error('The check needs a date like 2026-11-18.');
  const entries = Array.isArray(check.entries) ? check.entries : [];

  return withLock_(function () {
    const sh = checksSheet_();
    const existing = readObjects_(sh, CHECK_FIELDS);
    assertVersion_(baseVersion, checkVersion_(existing, check.date),
      'The ' + check.date + ' load check was changed by someone else after you opened it.');
    const rowByKey = {};
    existing.forEach(function (r) { rowByKey[r.date + '|' + r.driverId] = r._row; });

    const driverById = {};
    readObjects_(driversSheet_(), DRIVER_FIELDS).forEach(function (d) { driverById[d.id] = d; });

    const savedAt = Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd HH:mm');
    const appends = [];

    entries.forEach(function (e) {
      if (!e || !e.driverId) return;
      const driver = driverById[e.driverId] || {};
      const screenshotId = String(e.screenshotId || '');
      const screenshot2Id = String(e.screenshot2Id || '');
      const record = {
        date: check.date,
        updatedBy: String(check.updatedBy || ''),
        driverId: String(e.driverId),
        driverLabel: driver.label || '',
        driverName: driver.user || '',
        currentData: toNumberOrText_(e.currentData),
        load: String(e.load || ''),
        expDate: String(e.expDate || ''),
        expTime: String(e.expTime || ''),
        remarks: String(e.remarks || ''),
        screenshotId: screenshotId,
        screenshotUrl: driveLink_(screenshotId),
        savedAt: savedAt,
        screenshot2Id: screenshot2Id,
        screenshot2Url: driveLink_(screenshot2Id),
      };
      const values = CHECK_FIELDS.map(function (f) { return record[f[0]]; });
      const row = rowByKey[check.date + '|' + e.driverId];
      if (row) {
        sh.getRange(row, 1, 1, values.length).setValues([values]);
      } else {
        appends.push(values);
      }
    });

    if (appends.length) {
      sh.getRange(sh.getLastRow() + 1, 1, appends.length, CHECK_FIELDS.length).setValues(appends);
    }
    SpreadsheetApp.flush();
    refreshMonitorSheetSafe_();
    return { savedAt: savedAt, dataVersion: getDataVersion() };
  });
}

/** Deletes every row of one check. Screenshot files stay in Drive. baseVersion: as in saveCheck. */
function deleteCheck(date, baseVersion) {
  if (!isIsoDate_(date)) throw new Error('Unknown check date.');
  return withLock_(function () {
    const sh = checksSheet_();
    const all = readObjects_(sh, CHECK_FIELDS);
    assertVersion_(baseVersion, checkVersion_(all, date),
      'The ' + date + ' load check was changed by someone else after you opened it.');
    const rows = all
      .filter(function (r) { return String(r.date) === date; })
      .map(function (r) { return r._row; })
      .sort(function (a, b) { return b - a; });
    rows.forEach(function (r) { sh.deleteRow(r); });
    SpreadsheetApp.flush();
    refreshMonitorSheetSafe_();
    return { deleted: rows.length, dataVersion: getDataVersion() };
  });
}

/**
 * Adds a new driver (no id) or updates an existing one. Returns the saved driver.
 * baseVersion: the driver's `version` from getAppData. Ignored for new drivers; null skips the check.
 */
function saveDriver(driver, baseVersion) {
  if (!driver || !String(driver.label || '').trim()) throw new Error('Enter an account name, like "Driver Nine".');
  if (!String(driver.user || '').trim()) throw new Error('Enter the assigned driver\'s name.');

  return withLock_(function () {
    const sh = driversSheet_();
    const rows = readObjects_(sh, DRIVER_FIELDS);
    const d = Object.assign({}, driver);

    if (!d.id) {
      d.id = 'drv-' + Utilities.getUuid().slice(0, 8);
      const sorts = rows.map(function (r) { return Number(r.sort) || 0; }).filter(function (s) { return s < 100; });
      d.sort = (sorts.length ? Math.max.apply(null, sorts) : 0) + 1;
      if (d.active === undefined) d.active = true;
    }

    const match = rows.filter(function (r) { return r.id === d.id; })[0];
    // Passwords, PIN and phone model are edited in the sheet only: keep what's there.
    SHEET_ONLY_DRIVER_KEYS.forEach(function (k) { d[k] = match ? match[k] : ''; });
    if (driver.id) {
      assertVersion_(baseVersion, match ? driverVersion_(match) : '',
        (match && match.label ? match.label : 'This driver') + ' was changed by someone else after you opened it.');
    }
    const values = driverRow_(d);
    if (match) {
      sh.getRange(match._row, 1, 1, values.length).setValues([values]);
    } else {
      sh.getRange(sh.getLastRow() + 1, 1, 1, values.length).setValues([values]);
    }
    SpreadsheetApp.flush();
    refreshMonitorSheetSafe_();
    const saved = objectFromRow_(values, DRIVER_FIELDS);
    const out = cleanDriver_(saved);
    out.version = driverVersion_(saved);
    out.dataVersion = getDataVersion();
    return out;
  });
}

/**
 * Imports history from the old monitoring spreadsheet in one go (the app reads the file and
 * sends the result here). Additive only:
 *   - drivers already in the sheet (same account name, email or serial #) are left as they are;
 *   - load checks for dates already in the sheet are skipped, never overwritten.
 * payload: { drivers: [{ key, label, user, …, tracker }], checks: [{ date, updatedBy, entries: [{ driverKey, currentData, load, expDate, expTime, remarks }] }] }
 */
function importData(payload) {
  const drivers = (payload && Array.isArray(payload.drivers)) ? payload.drivers : [];
  const checks = (payload && Array.isArray(payload.checks)) ? payload.checks : [];
  if (drivers.length > 500) throw new Error('Too many drivers in one import (500 at most).');
  const entryCount = checks.reduce(function (n, c) { return n + ((c && Array.isArray(c.entries)) ? c.entries.length : 0); }, 0);
  if (entryCount > 20000) throw new Error('Too many rows in one import (20,000 at most). Import the sheet in parts.');
  const key = function (s) { return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim(); };

  return withLock_(function () {
    const dsh = driversSheet_();
    const existing = readObjects_(dsh, DRIVER_FIELDS);
    const byLabel = {}, byEmail = {}, bySerial = {};
    existing.forEach(function (r) {
      byLabel[key(r.label)] = r;
      if (r.email) byEmail[key(r.email)] = r;
      if (r.serial) bySerial[key(r.serial)] = r;
    });
    const sorts = existing.map(function (r) { return Number(r.sort) || 0; });
    let lowSort = Math.max.apply(null, [0].concat(sorts.filter(function (s) { return s < 100; })));
    let highSort = Math.max.apply(null, [99].concat(sorts.filter(function (s) { return s >= 100; })));

    const idByKey = {};
    const nameById = {};
    existing.forEach(function (r) { nameById[r.id] = { label: r.label, user: r.user }; });
    const newDriverRows = [];
    let matched = 0;
    drivers.forEach(function (d) {
      if (!d || !String(d.label || d.user || '').trim()) return;
      const k = key(d.key || d.label || d.user);
      if (idByKey[k]) return;
      const match = byLabel[key(d.label)] || (d.email && byEmail[key(d.email)]) || (d.serial && bySerial[key(d.serial)]);
      if (match) {
        idByKey[k] = match.id;
        matched++;
        return;
      }
      const rec = {
        id: 'drv-' + Utilities.getUuid().slice(0, 8),
        label: String(d.label || d.user).trim(),
        user: String(d.user || d.label).trim(),
        surname: d.surname, email: d.email, birthday: d.birthday, recoveryEmail: d.recoveryEmail,
        brand: d.brand, model: d.model, color: d.color, serial: d.serial, sim: d.sim,
        active: true,
        sort: d.tracker ? ++highSort : ++lowSort,
      };
      idByKey[k] = rec.id;
      byLabel[key(rec.label)] = rec;
      nameById[rec.id] = { label: rec.label, user: rec.user };
      newDriverRows.push(driverRow_(rec));
    });
    if (newDriverRows.length) {
      dsh.getRange(dsh.getLastRow() + 1, 1, newDriverRows.length, DRIVER_FIELDS.length).setValues(newDriverRows);
    }

    const csh = checksSheet_();
    const takenDates = {};
    readObjects_(csh, CHECK_FIELDS).forEach(function (r) { takenDates[String(r.date)] = true; });
    const savedAt = Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd HH:mm');
    const checkRows = [];
    const added = [], skipped = [];
    checks.forEach(function (c) {
      if (!c || !isIsoDate_(c.date)) return;
      if (takenDates[c.date]) { skipped.push(c.date); return; }
      const seen = {};
      const rows = [];
      (Array.isArray(c.entries) ? c.entries : []).forEach(function (e) {
        const id = e && idByKey[key(e.driverKey)];
        if (!id || seen[id]) return;
        seen[id] = true;
        const record = {
          date: c.date,
          updatedBy: String(c.updatedBy || '').slice(0, 100),
          driverId: id,
          driverLabel: nameById[id].label,
          driverName: nameById[id].user,
          currentData: toNumberOrText_(e.currentData),
          load: String(e.load || ''),
          expDate: isIsoDate_(e.expDate) ? e.expDate : '',
          expTime: String(e.expTime || ''),
          remarks: String(e.remarks || ''),
          screenshotId: '', screenshotUrl: '', savedAt: savedAt, screenshot2Id: '', screenshot2Url: '',
        };
        rows.push(CHECK_FIELDS.map(function (f) { return record[f[0]]; }));
      });
      if (!rows.length) return;
      takenDates[c.date] = true;
      added.push(c.date);
      Array.prototype.push.apply(checkRows, rows);
    });
    if (checkRows.length) {
      csh.getRange(csh.getLastRow() + 1, 1, checkRows.length, CHECK_FIELDS.length).setValues(checkRows);
    }
    SpreadsheetApp.flush();
    refreshMonitorSheetSafe_();
    return {
      driversAdded: newDriverRows.length,
      driversMatched: matched,
      checksAdded: added.length,
      checksSkipped: skipped,
      rowsAdded: checkRows.length,
      dataVersion: getDataVersion(),
    };
  });
}

/** Saves a pasted/uploaded screenshot (data URL) into the screenshots folder. */
function uploadScreenshot(payload) {
  const dataUrl = String((payload && payload.dataUrl) || '');
  if (dataUrl.length > CONFIG.MAX_UPLOAD_CHARS) throw new Error('That image is too large. Try a smaller screenshot.');
  const m = /^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) throw new Error('That file is not a PNG or JPG image.');

  const ext = m[1] === 'image/png' ? 'png' : m[1] === 'image/webp' ? 'webp' : m[1] === 'image/gif' ? 'gif' : 'jpg';
  const date = isIsoDate_(payload.date) ? payload.date : Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd');
  const label = String(payload.driverLabel || payload.driverId || 'driver').replace(/[^\w .-]/g, '').slice(0, 60);
  const slot = Number(payload.slot) === 2 ? 2 : 1;
  const blob = Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], date + ' ' + label + ' (' + slot + ').' + ext);

  const file = screenshotFolder_().createFile(blob);
  file.setDescription('Load check ' + date + ' for ' + label + ', screenshot ' + slot);
  return { fileId: file.getId() };
}

/** Returns a screenshot as a data URL, so the files can stay private in Drive. */
function getScreenshot(fileId) {
  const blob = screenshotFile_(fileId).getBlob();
  return 'data:' + blob.getContentType() + ';base64,' + Utilities.base64Encode(blob.getBytes());
}

/**
 * Small preview for lists: Drive's own thumbnail (about 220 px tall, a few KB) as a data URL.
 * Returns null when Drive hasn't made one yet; the app then shows the full screenshot instead.
 */
function getScreenshotThumb(fileId) {
  const file = screenshotFile_(fileId);
  let blob = null;
  try {
    blob = file.getThumbnail();
  } catch (e) {
    blob = null;
  }
  if (!blob) return null;
  return 'data:' + (blob.getContentType() || 'image/png') + ';base64,' + Utilities.base64Encode(blob.getBytes());
}

/** Moves a replaced or removed screenshot to the Drive trash (recoverable for 30 days). */
function removeScreenshot(fileId) {
  screenshotFile_(fileId).setTrashed(true);
  return true;
}

/* ------------------------------------------------------------------ */
/* Load requests: "Request load" -> Telegram HR group -> "Done loading" */
/* ------------------------------------------------------------------ */

/**
 * Sends one phone's latest load data and both GOMO screenshots to the HR group on Telegram.
 * payload: { driverId, requestedBy, note, askLoad }
 *   askLoad true (default): a load request with a "Done loading" button, recorded in "Load Requests".
 *   askLoad false: the current data only, for HR's information (no button, not recorded).
 */
function requestLoad(payload) {
  const askLoad = !(payload && payload.askLoad === false);
  const driverId = String((payload && payload.driverId) || '');
  const requestedBy = String((payload && payload.requestedBy) || '').trim().slice(0, 60);
  const note = String((payload && payload.note) || '').trim().slice(0, 300);
  if (!driverId) throw new Error('Pick a phone to request load for.');
  if (!requestedBy) throw new Error('Enter your name so HR knows who asked.');
  assertTelegramReady_();

  return withLock_(function () {
    const driver = readObjects_(driversSheet_(), DRIVER_FIELDS).filter(function (d) { return d.id === driverId; })[0];
    if (!driver) throw new Error('That phone is no longer in the Drivers list. Reload and try again.');

    const open = readObjects_(requestsSheet_(), REQUEST_FIELDS).filter(function (r) {
      return r.driverId === driverId && r.status === 'Requested';
    })[0];
    if (askLoad && open) {
      throw new Error('Load for ' + driver.label + ' was already requested (' + open.requestedAt + ' by ' +
        open.requestedBy + '). HR presses "Done loading" in Telegram once it is loaded.');
    }

    // Newest load check entry for this phone.
    const latest = readObjects_(checksSheet_(), CHECK_FIELDS)
      .filter(function (r) { return r.driverId === driverId && isIsoDate_(r.date); })
      .sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); })[0] || {};

    const out = sendLoadRequest_(driver, latest, requestedBy, note, askLoad);
    out.dataVersion = getDataVersion();
    return out;
  });
}

/**
 * Sends automatic load requests for the phones of one load check that are under LOW_DATA_GB.
 * The app calls this right after saveCheck (a separate call, so saving stays fast).
 * payload: { date, updatedBy }
 * A phone is skipped when this check isn't its newest reading, when a request for it is still
 * waiting for "Done loading", or when this same reading of this check was already sent, so saving
 * the check again never sends twice (editing the reading to another low value does send again).
 * Returns { sent: [{ driverLabel, photos }], failed: [{ driverLabel, error }], skipped: [{ driverLabel, reason }],
 *   remaining, retryAfter, dataVersion }.
 * remaining > 0: time ran out (or Telegram asked to slow down); call again after retryAfter seconds.
 */
function autoRequestLoads(payload) {
  const date = String((payload && payload.date) || '');
  const updatedBy = String((payload && payload.updatedBy) || '').trim();
  const result = { sent: [], failed: [], skipped: [], remaining: 0, retryAfter: 0, enabled: !!CONFIG.AUTO_REQUEST_LOW_DATA };
  if (!isIsoDate_(date)) throw new Error('Unknown check date.');
  if (!CONFIG.AUTO_REQUEST_LOW_DATA || !telegramToken_() || !telegramChatId_()) {
    result.enabled = false;
    return result;
  }

  const started = Date.now();
  const candidates = autoRequestCandidates_(date, null, result.skipped);
  for (let i = 0; i < candidates.length; i++) {
    if (Date.now() - started > CONFIG.AUTO_REQUEST_SECONDS * 1000 || result.retryAfter) {
      result.remaining = candidates.length - i;
      break;
    }
    const driverId = candidates[i];
    let label = driverId;
    try {
      withLock_(function () {
        // Checked again inside the lock: someone may have requested it meanwhile.
        if (autoRequestCandidates_(date, driverId).length === 0) return;
        const driver = readObjects_(driversSheet_(), DRIVER_FIELDS).filter(function (d) { return d.id === driverId; })[0];
        const entry = readObjects_(checksSheet_(), CHECK_FIELDS).filter(function (r) {
          return r.driverId === driverId && String(r.date) === date;
        })[0];
        if (!driver || !entry) return;
        label = String(driver.label || driverId);
        const note = 'Sent automatically: ' + gigabytes_(entry.currentData).toFixed(2) + ' GB left, under ' +
          CONFIG.LOW_DATA_GB + ' GB on the ' + telegramDate_(date) + ' load check.';
        const by = (updatedBy ? 'Auto · ' + updatedBy : 'Auto').slice(0, 60);
        const out = sendLoadRequest_(driver, entry, by, note, true);
        result.sent.push({ driverLabel: label, photos: out.photos });
      });
    } catch (err) {
      if (err && err.retryAfter) {
        // Telegram's group limit (about 20 messages a minute): stop here, the app calls again later.
        result.retryAfter = err.retryAfter;
        result.remaining = candidates.length - i;
        break;
      }
      result.failed.push({ driverLabel: label, error: err && err.message ? err.message : String(err) });
    }
  }
  result.dataVersion = getDataVersion();
  return result;
}

/**
 * Driver ids on the `date` check that should get an automatic load request (see autoRequestLoads).
 * onlyDriverId: check just that one phone.
 * skipped (optional array): low phones that are not sent get { driverLabel, reason } added to it.
 */
function autoRequestCandidates_(date, onlyDriverId, skipped) {
  const checks = readObjects_(checksSheet_(), CHECK_FIELDS);
  const newest = {};
  checks.forEach(function (r) {
    if (r.driverId && isIsoDate_(r.date) && !(newest[r.driverId] >= String(r.date))) newest[r.driverId] = String(r.date);
  });
  const requests = readObjects_(requestsSheet_(), REQUEST_FIELDS);
  const driverById = {};
  readObjects_(driversSheet_(), DRIVER_FIELDS).forEach(function (d) { driverById[d.id] = d; });
  const skip = function (r, reason) {
    if (skipped) skipped.push({ driverLabel: String((driverById[r.driverId] || {}).label || r.driverLabel || r.driverId), reason: reason });
    return false;
  };

  return checks
    .filter(function (r) {
      if (String(r.date) !== date || !r.driverId || !driverById[r.driverId]) return false;
      if (onlyDriverId && r.driverId !== onlyDriverId) return false;
      const gb = gigabytes_(r.currentData);
      if (gb === null || String(r.currentData).trim() === '' || gb >= CONFIG.LOW_DATA_GB) return false;
      if (newest[r.driverId] !== date) return skip(r, 'it has a newer load check (' + telegramDate_(newest[r.driverId]) + ')');
      const mine = requests.filter(function (q) { return q.driverId === r.driverId; });
      const open = mine.filter(function (q) { return q.status === 'Requested'; })[0];
      if (open) return skip(r, 'already requested ' + telegramDateTime_(open.requestedAt) + ', waiting for "Done loading"');
      // Already sent for this exact reading of this check (saving again doesn't resend; a new reading does).
      const same = mine.filter(function (q) {
        return String(q.checkDate) === date && gigabytes_(q.currentData) === gb;
      })[0];
      if (same) return skip(r, 'this reading was already sent ' + telegramDateTime_(same.requestedAt));
      return true;
    })
    .map(function (r) { return String(r.driverId); });
}

function assertTelegramReady_() {
  if (!telegramToken_() || !telegramChatId_()) {
    throw new Error('Telegram is not set up yet. Fill in TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in Code.gs ' +
      '(see README, "Load requests on Telegram") and deploy a new version.');
  }
}

/**
 * Posts one phone's reading to the HR group and, for a load request, records it in "Load Requests".
 * Call with the script lock held. latest: the phone's Load Checks row ({} when it has none).
 */
function sendLoadRequest_(driver, latest, requestedBy, note, askLoad) {
  const req = {
    id: 'req-' + Utilities.getUuid().slice(0, 8),
    requestedAt: Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd HH:mm'),
    requestedBy: requestedBy,
    driverId: String(driver.id),
    driverLabel: String(driver.label || ''),
    driverName: String(driver.user || ''),
    sim: String(driver.sim || ''),
    currentData: latest.currentData === undefined ? '' : String(latest.currentData),
    load: String(latest.load || ''),
    expires: [latest.expDate ? telegramDate_(latest.expDate) : '', String(latest.expTime || '')]
      .filter(function (s) { return s; }).join(', '),
    checkDate: String(latest.date || ''),
    screenshotId: String(latest.screenshotId || ''),
    screenshot2Id: String(latest.screenshot2Id || ''),
    note: note,
    status: askLoad ? 'Requested' : 'Info',
    doneAt: '',
    doneBy: '',
    telegramMessageId: '',
  };

  const sent = sendRequestToTelegram_(req);
  req.telegramMessageId = String(sent.messageId);

  if (askLoad) {
    const sh = requestsSheet_();
    sh.getRange(sh.getLastRow() + 1, 1, 1, REQUEST_FIELDS.length)
      .setValues([REQUEST_FIELDS.map(function (f) { return req[f[0]]; })]);
    SpreadsheetApp.flush();
  }
  return {
    request: askLoad ? cleanRequest_(req) : null,
    photos: sent.photos,
    photo: sent.photos > 0, // older app versions read this
  };
}

/**
 * Posts the request and returns { messageId, photos }. messageId is the message that carries the
 * text (and the "Done loading" button for a load request).
 *   2 screenshots: an album with both, then the details right under it, as a reply to the album
 *                  (Telegram doesn't allow buttons on an album).
 *   1 screenshot:  one photo with the details as its caption.
 *   none:          the details as text.
 */
function sendRequestToTelegram_(req) {
  const chatId = telegramChatId_();
  const text = requestCaption_(req);
  const keyboard = req.status === 'Requested'
    ? { inline_keyboard: [[{ text: '✅ Done loading', callback_data: 'done:' + req.id }]] }
    : null;

  const blobs = [];
  [req.screenshotId, req.screenshot2Id].forEach(function (id, i) {
    if (!id) return;
    try {
      blobs.push(screenshotFile_(id).getBlob());
    } catch (err) {
      Logger.log('Screenshot ' + (i + 1) + ' not attached to ' + req.id + ': ' + err.message);
    }
  });

  if (blobs.length === 1) {
    try {
      const params = { chat_id: chatId, photo: blobs[0], caption: text, parse_mode: 'HTML' };
      if (keyboard) params.reply_markup = JSON.stringify(keyboard);
      return { messageId: telegram_('sendPhoto', params, true).message_id, photos: 1 };
    } catch (err) {
      if (err.retryAfter) throw err;
      Logger.log('Photo refused for ' + req.id + ': ' + err.message);
    }
  }

  let album = null;
  if (blobs.length > 1) {
    const params = {
      chat_id: chatId,
      media: JSON.stringify(blobs.map(function (b, i) { return { type: 'photo', media: 'attach://shot' + i }; })),
    };
    blobs.forEach(function (b, i) { params['shot' + i] = b; });
    try {
      album = telegram_('sendMediaGroup', params, true);
    } catch (err) {
      if (err.retryAfter) throw err;
      Logger.log('Album refused for ' + req.id + ': ' + err.message);
    }
  }

  const params = { chat_id: chatId, text: text, parse_mode: 'HTML' };
  if (keyboard) params.reply_markup = keyboard;
  if (album && album.length) params.reply_parameters = { message_id: album[0].message_id, allow_sending_without_reply: true };
  const msg = telegram_('sendMessage', params);
  return { messageId: msg.message_id, photos: album ? album.length : 0 };
}

/** The Telegram text for a request; ends with "Loaded by …" once it is done. */
function requestCaption_(req) {
  const gb = gigabytes_(req.currentData);
  const lines = [
    req.status === 'Info' ? '📊 <b>Current load data</b>'
      : (req.status === 'Done' ? '🟢' : '🔴') + ' <b>Load request</b>',
    '<b>' + html_(req.driverLabel) + '</b>' + (req.driverName ? ' · ' + html_(req.driverName) : ''),
  ];
  if (req.sim) lines.push('📱 GOMO SIM: <code>' + html_(req.sim) + '</code>');
  if (String(req.currentData) !== '') {
    lines.push('📶 Data left: <b>' + html_(gb === null ? req.currentData : gb.toFixed(2) + ' GB') + '</b>' +
      (req.checkDate ? ' (checked ' + html_(telegramDate_(req.checkDate)) + ')' : ''));
  } else {
    lines.push('📶 Data left: no load check yet');
  }
  if (req.load || req.expires) {
    lines.push('🎫 ' + html_(req.load || 'Promo') + (req.expires ? ' · ends ' + html_(req.expires) : ''));
  }
  if (req.note) lines.push('📝 ' + html_(req.note));
  lines.push('', (req.status === 'Info' ? 'Sent by ' : 'Requested by ') + html_(req.requestedBy) + ' · ' +
    html_(telegramDateTime_(req.requestedAt)));
  if (req.status === 'Info') {
    // information only: nothing for HR to press
  } else if (req.status === 'Done') {
    lines.push('✅ <b>Loaded</b> by ' + html_(req.doneBy || 'HR') + ' · ' + html_(telegramDateTime_(req.doneAt)));
  } else {
    lines.push('Press <b>Done loading</b> once the phone is loaded.');
  }
  return lines.join('\n').slice(0, 1024); // Telegram's caption limit
}

/**
 * One update from Telegram, passed on by the Vercel webhook (api/telegram.js), which has already
 * checked Telegram's secret header. Handles the "Done loading" button and the /chatid command.
 */
function telegramUpdate(update) {
  if (!update || typeof update !== 'object' || !telegramToken_()) return { handled: false };

  const msg = update.message;
  if (msg && msg.chat && /^\/chatid(@\w+)?(\s|$)/i.test(String(msg.text || ''))) {
    telegram_('sendMessage', {
      chat_id: msg.chat.id,
      text: 'This chat\'s id is ' + msg.chat.id + '\nPut it in TELEGRAM_CHAT_ID in Code.gs and deploy a new version.',
    });
    return { handled: true };
  }

  const cb = update.callback_query;
  if (!cb || !/^done:req-[\w-]+$/.test(String(cb.data || ''))) return { handled: false };
  const answer = function (text) {
    try {
      telegram_('answerCallbackQuery', { callback_query_id: cb.id, text: text });
    } catch (err) {
      Logger.log('answerCallbackQuery failed: ' + err.message);
    }
  };
  const chatId = cb.message && cb.message.chat ? String(cb.message.chat.id) : '';
  if (!chatId || chatId !== telegramChatId_()) {
    answer('This button only works in the HR group.');
    return { handled: true };
  }

  const id = String(cb.data).slice('done:'.length);
  const from = cb.from || {};
  const who = ([from.first_name, from.last_name].filter(Boolean).join(' ') ||
    (from.username ? '@' + from.username : 'HR')).slice(0, 60);

  const result = withLock_(function () {
    const sh = requestsSheet_();
    const row = readObjects_(sh, REQUEST_FIELDS).filter(function (r) { return r.id === id; })[0];
    if (!row) return { text: 'This request is no longer in the sheet.' };
    if (row.status === 'Done') return { text: 'Already marked done by ' + (row.doneBy || 'someone') + '.', row: row };
    row.status = 'Done';
    row.doneAt = Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd HH:mm');
    row.doneBy = who;
    sh.getRange(row._row, 1, 1, REQUEST_FIELDS.length).setValues([REQUEST_FIELDS.map(function (f) { return row[f[0]]; })]);
    SpreadsheetApp.flush();
    return { text: 'Marked as loaded. Thank you!', row: row };
  });

  answer(result.text);
  if (result.row && cb.message) {
    // Show "Loaded by …" on the message and remove the button.
    const isPhoto = !!(cb.message.photo && cb.message.photo.length);
    const params = {
      chat_id: chatId,
      message_id: cb.message.message_id,
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [] },
    };
    params[isPhoto ? 'caption' : 'text'] = requestCaption_(result.row);
    try {
      telegram_(isPhoto ? 'editMessageCaption' : 'editMessageText', params);
    } catch (err) {
      // "message is not modified" when someone presses an already-updated button: fine.
      Logger.log('Could not update the Telegram message: ' + err.message);
    }
  }
  return { handled: true };
}

/**
 * Run once from the editor after filling in TELEGRAM_BOT_TOKEN and APP_URL (and after
 * generateSyncToken). Points the bot at the Vercel app so /chatid and "Done loading" work.
 */
function connectTelegram() {
  const appUrl = String(APP_URL || PropertiesService.getScriptProperties().getProperty('APP_URL') || '')
    .trim().replace(/\/+$/, '');
  if (!telegramToken_()) throw new Error('Fill in TELEGRAM_BOT_TOKEN at the top of Code.gs first.');
  if (!/^https:\/\//.test(appUrl)) throw new Error('Fill in APP_URL (the https:// Vercel address) at the top of Code.gs first.');
  if (!syncToken_()) throw new Error('Run generateSyncToken first (the Telegram link is protected with it).');

  const me = telegram_('getMe', {});
  telegram_('setWebhook', {
    url: appUrl + '/api/telegram',
    secret_token: telegramSecret_(),
    allowed_updates: ['message', 'callback_query'],
    drop_pending_updates: true,
  });
  Logger.log('Connected @' + me.username + ' to ' + appUrl + '/api/telegram.\n' + (telegramChatId_()
    ? 'Requests go to chat ' + telegramChatId_() + '. Run testTelegram to send a test message.'
    : 'Next: add @' + me.username + ' to the HR group, send /chatid there, and put the answer in TELEGRAM_CHAT_ID.'));
}

/** Run from the editor to send a test message to the HR group. */
function testTelegram() {
  if (!telegramChatId_()) throw new Error('Fill in TELEGRAM_CHAT_ID first.');
  telegram_('sendMessage', {
    chat_id: telegramChatId_(),
    text: '👋 Sheehan Load Monitor is connected. Load requests will appear here.',
  });
  Logger.log('Test message sent.');
}

function telegramToken_() {
  return String(TELEGRAM_BOT_TOKEN || PropertiesService.getScriptProperties().getProperty('TELEGRAM_BOT_TOKEN') || '').trim();
}

function telegramChatId_() {
  return String(TELEGRAM_CHAT_ID || PropertiesService.getScriptProperties().getProperty('TELEGRAM_CHAT_ID') || '').trim();
}

/**
 * Secret Telegram sends with every webhook call. Made from the sync token so Vercel can work it out
 * too (api/telegram.js) without another setting, while Telegram never sees the sync token itself.
 */
function telegramSecret_() {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, 'telegram-webhook:' + syncToken_(), Utilities.Charset.UTF_8);
  return bytes.map(function (b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
}

/**
 * Calls the Telegram Bot API. multipart: true when the payload holds a file (sendPhoto).
 * "Too Many Requests" (a group takes about 20 messages a minute): waits and tries once more when the
 * wait is short, otherwise throws an error with `retryAfter` (seconds).
 */
function telegram_(method, payload, multipart) {
  const options = { method: 'post', muteHttpExceptions: true };
  if (multipart) {
    options.payload = payload;
  } else {
    options.contentType = 'application/json';
    options.payload = JSON.stringify(payload);
  }
  const url = 'https://api.telegram.org/bot' + telegramToken_() + '/' + method;
  let body = {};
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = UrlFetchApp.fetch(url, options);
    try {
      body = JSON.parse(res.getContentText() || '{}');
    } catch (err) {
      body = {};
    }
    const wait = body.error_code === 429 && body.parameters ? Number(body.parameters.retry_after) || 0 : 0;
    if (!wait) break;
    if (attempt === 0 && wait <= 10) {
      Utilities.sleep(wait * 1000 + 250);
      continue;
    }
    const busy = new Error('Telegram is busy (too many messages). Try again in ' + wait + ' seconds.');
    busy.retryAfter = wait;
    throw busy;
  }
  if (!body.ok) {
    const why = body.description || ('HTTP ' + res.getResponseCode());
    if (/chat not found/i.test(why)) throw new Error('Telegram: the HR group was not found. Check TELEGRAM_CHAT_ID and that the bot is in the group.');
    if (/unauthorized/i.test(why)) throw new Error('Telegram: the bot token was refused. Check TELEGRAM_BOT_TOKEN.');
    throw new Error('Telegram: ' + why);
  }
  return body.result;
}

function html_(s) {
  return String(s === undefined || s === null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** '2026-11-19' -> 'Nov 19' */
function telegramDate_(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  if (!m) return String(iso || '');
  return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m[2]) - 1] + ' ' + Number(m[3]);
}

/** '2026-11-19 14:05' -> 'Nov 19, 2:05 PM' */
function telegramDateTime_(s) {
  const m = /^(\d{4}-\d{2}-\d{2})\s+(\d{1,2}):(\d{2})/.exec(String(s || ''));
  if (!m) return String(s || '');
  const h = Number(m[2]);
  return telegramDate_(m[1]) + ', ' + (h % 12 || 12) + ':' + m[3] + ' ' + (h < 12 ? 'AM' : 'PM');
}

function cleanRequest_(r) {
  const out = {};
  REQUEST_FIELDS.forEach(function (f) {
    if (f[0] === 'telegramMessageId') return;
    out[f[0]] = r[f[0]] === undefined || r[f[0]] === null ? '' : String(r[f[0]]);
  });
  return out;
}

/* ------------------------------------------------------------------ */
/* "Load Monitoring" tab: the old monitoring sheet's layout, rebuilt   */
/* from Drivers + Load Checks after every save                         */
/* ------------------------------------------------------------------ */

/** Rows 1-3 hold the title band and the column headers. */
const MONITOR_FIRST_ROW_ = 4;

/**
 * Columns of the "Load Monitoring" tab: exactly the old SHEEHAN DRIVER LOAD MONITORING sheet (A-S),
 * then Remarks and the two screenshots. Password, Phone Model, Messenger Password and GOMO APP PIN come
 * from the sheet-only columns of "Drivers" (Phone Model falls back to MODEL when empty).
 * The last three are hidden bookkeeping: the row's driver ID (or "check:<date>" on an "Updated By" row)
 * and which Drive file each picture came from, so pictures already in the sheet aren't fetched again.
 */
const MONITOR_COLUMNS = [
  { key: 'label', title: 'Name:', width: 100, align: 'left' },
  { key: 'user', title: 'USER', width: 230, align: 'left' },
  { key: 'surname', title: 'Surname:', width: 65, align: 'left' },
  { key: 'email', title: 'Driver Emails:', width: 230, align: 'center' },
  { key: 'password', title: 'Password:', width: 95, align: 'left' },
  { key: 'birthday', title: 'Birthday:', width: 65, align: 'right' },
  { key: 'recoveryEmail', title: 'Recovery Email:', width: 115, align: 'left' },
  { key: 'currentData', title: 'Current Data:', width: 185, align: 'center' },
  { key: 'brand', title: 'BRAND', width: 110, align: 'left' },
  { key: 'model', title: 'MODEL', width: 85, align: 'center' },
  { key: 'color', title: 'COLOR', width: 85, align: 'left' },
  { key: 'serial', title: 'SERIAL #', width: 95, align: 'center' },
  { key: 'phoneModel', title: 'Phone Model:', width: 85, align: 'left' },
  { key: 'sim', title: 'GOMO SIM#', width: 95, align: 'center' },
  { key: 'messengerPassword', title: 'Messenger Password', width: 130, align: 'center' },
  { key: 'load', title: 'Availed Load:', width: 145, align: 'center' },
  { key: 'expDate', title: 'Exp. Date', width: 72, align: 'center' },
  { key: 'expTime', title: 'Exp. Time', width: 65, align: 'center' },
  { key: 'appPin', title: 'GOMO APP PIN', width: 95, align: 'center' },
  { key: 'remarks', title: 'Remarks', width: 160, align: 'left' },
  { key: 'shot1', title: 'Screenshot 1', width: 80, align: 'center' },
  { key: 'shot2', title: 'Screenshot 2', width: 80, align: 'center' },
  { key: 'rowKey', title: 'Row Key', width: 100, align: 'left' },
  { key: 'shot1Key', title: 'Screenshot 1 Key', width: 100, align: 'left' },
  { key: 'shot2Key', title: 'Screenshot 2 Key', width: 100, align: 'left' },
];

/** Column index (0-based) by key. */
const MON_ = MONITOR_COLUMNS.reduce(function (m, c, i) { m[c.key] = i; return m; }, {});
const MONITOR_VISIBLE_ = MON_.shot2 + 1;

const MONITOR_COLORS_ = {
  title: '#FFFF00',
  noExpiry: '#FF9900',
  specs: '#FCE5CD',
  header: '#D9D9D9',
  low: '#F4CCCC',
  expiring: '#F4CCCC',
  active: '#D9EAD3',
  load: '#00FF00',
  link: '#1155CC',
  none: '#FFFFFF',
};

/** COLOR column chips: [background, text]. Other colors stay plain. */
const PHONE_COLORS_ = {
  black: ['#202124', '#FFFFFF'],
  'sky blue': ['#BFE1F6', '#0B57D0'],
  blue: ['#0B57D0', '#FFFFFF'],
  'light blue': ['#BFE1F6', '#0B57D0'],
  green: ['#D4EDBC', '#11734B'],
  red: ['#FFCFC9', '#B10202'],
  pink: ['#FFC8E6', '#8E0F5A'],
  purple: ['#E6CFF2', '#5A3286'],
  gray: ['#E8EAED', '#3C4043'],
  grey: ['#E8EAED', '#3C4043'],
  silver: ['#E8EAED', '#3C4043'],
  gold: ['#FFE5A0', '#473821'],
};

/** Adds a "Load Monitor" menu to the sheet (only when this script was opened from the sheet). */
function onOpen() {
  try {
    SpreadsheetApp.getUi()
      .createMenu('Load Monitor')
      .addItem('Rebuild the "' + CONFIG.MONITOR_SHEET + '" tab', 'rebuildLoadMonitoring')
      .addToUi();
  } catch (e) {
    // opened without a UI (e.g. from a trigger); nothing to add
  }
}

/**
 * Run from the editor (or Load Monitor menu in the sheet) to rebuild the "Load Monitoring" tab now,
 * including every screenshot. The app also refreshes it by itself after each save.
 */
function rebuildLoadMonitoring() {
  const r = withLock_(function () { return refreshMonitorSheet_(CONFIG.MONITOR_IMAGES_PER_RUN, true); });
  Logger.log('"' + CONFIG.MONITOR_SHEET + '" rebuilt: ' + r.checks + ' load checks, ' + r.images + ' screenshots.' +
    (r.pending ? ' ' + r.pending + ' screenshots are still to be added: run rebuildLoadMonitoring again.' : '') +
    (r.missing ? ' ' + r.missing + ' screenshot files could not be found in Drive.' : ''));
}

/** After a save: refresh the tab, but never let a problem here fail the save itself. */
function refreshMonitorSheetSafe_() {
  try {
    refreshMonitorSheet_(CONFIG.MONITOR_IMAGES_PER_SAVE, false);
  } catch (e) {
    console.error('The "' + CONFIG.MONITOR_SHEET + '" tab was not updated: ' + (e && e.stack ? e.stack : e));
  }
}

/**
 * Rewrites the "Load Monitoring" tab: one "Updated By / Date" block per check, oldest at the top,
 * one row per phone, with the two screenshots as pictures inside the cells (they shrink to fit).
 * maxFetches: how many screenshots may be read from Drive this time. retryMissing: look again for
 * screenshot files that weren't found last time.
 */
function refreshMonitorSheet_(maxFetches, retryMissing) {
  const tab = monitorSheet_();
  const sh = tab.sheet;
  const first = MONITOR_FIRST_ROW_;
  const width = MONITOR_COLUMNS.length;

  // Pictures already in the tab, by Drive file ID, so they're reused instead of fetched again.
  // (Not when the tab still has an older column layout: everything is fetched fresh then.)
  const known = {};
  const oldLast = sh.getLastRow();
  if (oldLast >= first && !tab.layoutChanged) {
    const tail = width - MON_.shot1;
    sh.getRange(first, MON_.shot1 + 1, oldLast - first + 1, tail).getValues().forEach(function (r) {
      [[MON_.shot1, MON_.shot1Key], [MON_.shot2, MON_.shot2Key]].forEach(function (p) {
        const key = parseShotKey_(r[p[1] - MON_.shot1]);
        if (!key) return;
        const cell = r[p[0] - MON_.shot1];
        if (isCellImage_(cell)) known[key.id] = { image: cell, kind: key.kind === 'full' ? 'full' : 'thumb' };
        else if (key.kind === 'missing' && !retryMissing) known[key.id] = { image: null, kind: 'missing' };
      });
    });
  }

  const driverById = {};
  readObjects_(driversSheet_(), DRIVER_FIELDS).forEach(function (d) { driverById[d.id] = d; });
  const byDate = {};
  readObjects_(checksSheet_(), CHECK_FIELDS).forEach(function (r) {
    const date = String(r.date);
    if (isIsoDate_(date)) (byDate[date] = byDate[date] || []).push(r);
  });
  const order = function (r) {
    const d = driverById[r.driverId];
    return d ? Number(d.sort) || 0 : Infinity;
  };

  const rows = [];
  const blocks = [];
  const budget = { left: maxFetches, pending: 0, missing: 0, images: 0 };

  Object.keys(byDate).sort().forEach(function (date) { // oldest first; new checks land at the bottom
    const entries = byDate[date].slice().sort(function (a, b) {
      return (order(a) - order(b)) || String(a.driverLabel).localeCompare(String(b.driverLabel));
    });

    rows.push(monitorRow_(), monitorRow_()); // 2 blank lines between checks, like the old sheet
    const block = { from: first + rows.length, to: 0, shots: [] };
    const head = monitorRow_();
    head.values[MON_.label] = 'Updated By:';
    head.values[MON_.user] = entries.reduce(function (s, r) { return r.updatedBy ? String(r.updatedBy) : s; }, '');
    head.weight[MON_.user] = 'bold';
    head.values[MON_.surname] = 'Date:';
    head.values[MON_.email] = monitorCheckDate_(date);
    head.weight[MON_.email] = 'bold';
    head.align[MON_.email] = 'left';
    head.values[MON_.rowKey] = 'check:' + date;
    rows.push(head);

    entries.forEach(function (r) {
      const row = monitorEntryRow_(r, driverById[r.driverId] || {}, date);
      const rowNumber = first + rows.length;
      [['screenshotId', MON_.shot1, MON_.shot1Key, 1], ['screenshot2Id', MON_.shot2, MON_.shot2Key, 2]].forEach(function (s) {
        const id = String(r[s[0]] || '').trim();
        if (!id) return;
        const title = row.values[MON_.label] + ' ' + date + ' screenshot ' + s[3];
        const got = monitorImage_(id, known, budget, title);
        row.values[s[2]] = id + ':' + got.kind;
        block.shots.push({ row: rowNumber, col: s[1], keyCol: s[2], id: id, image: got.image });
      });
      rows.push(row);
    });
    block.to = first + rows.length - 1;
    blocks.push(block);
  });

  // Clear the old body (values, pictures and formatting), then write everything in a few batched calls.
  const n = rows.length;
  if (sh.getMaxRows() < first + n) sh.insertRowsAfter(sh.getMaxRows(), first + n - sh.getMaxRows());
  if (oldLast >= first) {
    sh.getRange(first, 1, oldLast - first + 1, sh.getMaxColumns()).clear().clearDataValidations();
    sh.setRowHeights(first, oldLast - first + 1, 21);
  }

  if (n) {
    const pick = function (k) { return rows.map(function (r) { return r[k]; }); };
    sh.getRange(first, 1, n, width)
      .setNumberFormats(pick('format'))
      .setValues(pick('values'))
      .setBackgrounds(pick('bg'))
      .setFontColors(pick('color'))
      .setFontWeights(pick('weight'))
      .setFontLines(pick('line'))
      .setHorizontalAlignments(pick('align'))
      .setVerticalAlignment('middle')
      .setFontFamily('Arial')
      .setFontSize(10);
    sh.setRowHeights(first, n, 21);
    sh.getRangeList(blocks.map(function (b) {
      return sh.getRange(b.from, 1, b.to - b.from + 1, MONITOR_VISIBLE_).getA1Notation();
    })).setBorder(true, true, true, true, true, true, '#000000', SpreadsheetApp.BorderStyle.SOLID);
    setMonitorDropdowns_(sh, rows, ['brand', 'color']);

    blocks.forEach(function (b) {
      if (!b.shots.length) return;
      // Taller rows so the pictures are readable; each picture scales itself to its cell.
      if (b.to > b.from) sh.setRowHeights(b.from + 1, b.to - b.from, CONFIG.MONITOR_IMAGE_ROW_HEIGHT);
      writeMonitorImages_(sh, b, budget);
    });
  }
  SpreadsheetApp.flush();
  return { checks: blocks.length, images: budget.images, pending: budget.pending, missing: budget.missing };
}

/**
 * BRAND and COLOR show as dropdowns like the old sheet (the values seen in that column), on phone rows only.
 * The tab is rebuilt from the data, so picking a value here doesn't change anything.
 */
function setMonitorDropdowns_(sh, rows, keys) {
  keys.forEach(function (key) {
    const col = MON_[key];
    const seen = {};
    rows.forEach(function (r) {
      const v = String(r.values[col] || '');
      if (v && r.values[MON_.rowKey] && String(r.values[MON_.rowKey]).indexOf('check:') !== 0) seen[v] = true;
    });
    const list = Object.keys(seen).sort().slice(0, 500);
    if (!list.length) return;
    const rule = SpreadsheetApp.newDataValidation().requireValueInList(list, true).setAllowInvalid(true).build();
    sh.getRange(MONITOR_FIRST_ROW_, col + 1, rows.length, 1).setDataValidations(rows.map(function (r) {
      const isPhone = r.values[MON_.rowKey] && String(r.values[MON_.rowKey]).indexOf('check:') !== 0;
      return [isPhone && r.values[col] ? rule : null];
    }));
  });
}

/**
 * Creates the tab the first time, and (re)writes the title band and headers like the old sheet.
 * Returns { sheet, layoutChanged }: layoutChanged when the tab was made with other columns.
 */
function monitorSheet_() {
  const ss = spreadsheet_();
  let sh = ss.getSheetByName(CONFIG.MONITOR_SHEET);
  const created = !sh;
  if (created) sh = ss.insertSheet(CONFIG.MONITOR_SHEET, 0);
  const width = MONITOR_COLUMNS.length;
  if (sh.getMaxColumns() < width) sh.insertColumnsAfter(sh.getMaxColumns(), width - sh.getMaxColumns());
  const titles = MONITOR_COLUMNS.map(function (c) { return c.title; });
  const layoutChanged = !created &&
    sh.getRange(3, 1, 1, width).getValues()[0].join('\u0001') !== titles.join('\u0001');

  if (created || layoutChanged) {
    // Only for a new tab or new columns, so column widths someone changes by hand are kept.
    sh.showColumns(1, sh.getMaxColumns());
    MONITOR_COLUMNS.forEach(function (c, i) { sh.setColumnWidth(i + 1, c.width); });
    sh.setRowHeight(1, 8);
    sh.setRowHeight(2, 28);
    sh.setRowHeight(3, 21);
  }
  if (created) {
    sh.protect()
      .setWarningOnly(true)
      .setDescription('Made by the load monitor app from "Drivers" and "Load Checks". Edits here are replaced on the next save.');
  }

  const C = MONITOR_COLORS_;
  sh.getRange(1, 1, 3, width).breakApart().clear();
  sh.getRange(1, 1, 3, width).setFontFamily('Arial').setFontSize(10).setVerticalAlignment('bottom');
  sh.getRange(1, 1, 2, MON_.currentData + 1).setBackground(C.title);
  sh.getRange(2, MON_.user + 1, 1, MON_.currentData - MON_.user).merge()
    .setValue('SHEEHAN DRIVER LOAD MONITORING')
    .setFontSize(14);
  sh.getRange(2, MON_.currentData + 1)
    .setValue('NO EXPIRY DATA Subscription:')
    .setBackground(C.noExpiry)
    .setFontWeight('bold')
    .setHorizontalAlignment('center');
  sh.getRange(1, MON_.brand + 1, 2, MONITOR_VISIBLE_ - MON_.brand).merge()
    .setValue('PHONE SPECS & OTHERS')
    .setBackground(C.specs)
    .setFontWeight('bold')
    .setFontSize(15)
    .setHorizontalAlignment('center');
  sh.getRange(3, 1, 1, width)
    .setValues([titles])
    .setBackground(C.header)
    .setFontWeight('bold')
    .setHorizontalAlignment('center');
  sh.getRange(3, 1, 1, MONITOR_VISIBLE_)
    .setBorder(true, true, true, true, true, true, '#000000', SpreadsheetApp.BorderStyle.SOLID);
  sh.setFrozenRows(3);
  sh.hideColumns(MONITOR_VISIBLE_ + 1, width - MONITOR_VISIBLE_);
  return { sheet: sh, layoutChanged: layoutChanged };
}

/** An empty row: values plus the formatting arrays written in one go. */
function monitorRow_() {
  const fill = function (v) { return MONITOR_COLUMNS.map(function () { return v; }); };
  return {
    values: fill(''),
    format: fill('@'), // keep dates, times and SIM numbers (leading 0) exactly as written
    bg: fill(MONITOR_COLORS_.none),
    color: fill('#000000'),
    weight: fill('normal'),
    line: fill('none'),
    align: MONITOR_COLUMNS.map(function (c) { return c.align; }),
  };
}

/** One phone's row of a check, colored like the old sheet. */
function monitorEntryRow_(r, d, date) {
  const C = MONITOR_COLORS_;
  const row = monitorRow_();
  const v = row.values;
  const text = function (x) { return x === undefined || x === null ? '' : String(x).trim(); };

  v[MON_.label] = text(d.label || r.driverLabel);
  v[MON_.user] = text(r.driverName || d.user);
  v[MON_.surname] = text(d.surname);
  v[MON_.email] = text(d.email);
  v[MON_.birthday] = monitorShortDate_(d.birthday);
  v[MON_.recoveryEmail] = text(d.recoveryEmail);
  ['password', 'brand', 'model', 'color', 'serial', 'sim', 'messengerPassword', 'appPin']
    .forEach(function (k) { v[MON_[k]] = text(d[k]); });
  v[MON_.phoneModel] = text(d.phoneModel || d.model);
  v[MON_.load] = text(r.load);
  v[MON_.expDate] = monitorShortDate_(r.expDate);
  v[MON_.expTime] = text(r.expTime);
  v[MON_.remarks] = text(r.remarks);
  v[MON_.rowKey] = text(r.driverId);

  if (v[MON_.email]) {
    row.color[MON_.email] = C.link;
    row.line[MON_.email] = 'underline';
  }

  if (typeof r.currentData === 'number') {
    v[MON_.currentData] = r.currentData;
    row.format[MON_.currentData] = '0.00"GB"'; // shows 2.86GB like the old sheet
  } else {
    v[MON_.currentData] = text(r.currentData);
  }
  const gb = gigabytes_(r.currentData);
  if (gb !== null && gb < CONFIG.LOW_DATA_GB) row.bg[MON_.currentData] = C.low;

  if (v[MON_.load]) row.bg[MON_.load] = C.load;

  const days = daysBetween_(date, r.expDate);
  if (days !== null) row.bg[MON_.expDate] = days <= CONFIG.EXPIRING_DAYS ? C.expiring : C.active;

  const chip = PHONE_COLORS_[v[MON_.color].toLowerCase()];
  if (chip) {
    row.bg[MON_.color] = chip[0];
    row.color[MON_.color] = chip[1];
  }
  return row;
}

/**
 * The picture for one screenshot: reused from the tab when it's already there, else read from Drive.
 * Uses Drive's small thumbnail (keeps the sheet light). Right after an upload Drive may not have made
 * one yet, so the full screenshot is used until a later save swaps in the thumbnail.
 * kind: 'thumb' | 'full' | 'pending' (try again next time) | 'missing' (file not in the folder).
 */
function monitorImage_(fileId, known, budget, title) {
  const have = known[fileId];
  if (have && have.kind === 'missing') {
    budget.missing++;
    return have;
  }
  if (have && have.kind === 'thumb') return have;
  if (budget.left <= 0) {
    if (!have) budget.pending++;
    return have || { image: null, kind: 'pending' };
  }
  budget.left--;

  let file;
  try {
    file = screenshotFile_(fileId);
  } catch (e) {
    budget.missing++;
    return { image: null, kind: 'missing' };
  }
  try {
    let blob = null;
    try {
      blob = file.getThumbnail();
    } catch (e) {
      blob = null;
    }
    let kind = 'thumb';
    if (!blob) {
      if (have) return have; // keep the full-size picture until Drive has a thumbnail
      blob = file.getBlob();
      kind = 'full';
    }
    const bytes = blob.getBytes();
    if (bytes.length > CONFIG.MONITOR_MAX_IMAGE_BYTES) {
      budget.pending++;
      return have || { image: null, kind: 'pending' };
    }
    const image = SpreadsheetApp.newCellImage()
      .setSourceUrl('data:' + (blob.getContentType() || 'image/png') + ';base64,' + Utilities.base64Encode(bytes))
      .setAltTextTitle(title)
      .build();
    return { image: image, kind: kind };
  } catch (e) {
    console.warn('Screenshot ' + fileId + ' not added to the sheet: ' + e);
    budget.pending++;
    return have || { image: null, kind: 'pending' };
  }
}

/** Puts one check's pictures into their cells (one call per check; cell by cell if that fails). */
function writeMonitorImages_(sh, block, budget) {
  const shots = block.shots.filter(function (s) { return s.image; });
  if (!shots.length) return;
  const asValue = function (img) { return typeof img.toBuilder === 'function' ? img.toBuilder().build() : img; };
  const top = block.from + 1;
  const grid = [];
  for (let r = top; r <= block.to; r++) grid.push(['', '']);
  shots.forEach(function (s) { grid[s.row - top][s.col - MON_.shot1] = asValue(s.image); });
  try {
    sh.getRange(top, MON_.shot1 + 1, grid.length, 2).setValues(grid);
    SpreadsheetApp.flush();
    budget.images += shots.length;
  } catch (e) {
    shots.forEach(function (s) {
      try {
        sh.getRange(s.row, s.col + 1).setValue(asValue(s.image));
        SpreadsheetApp.flush();
        budget.images++;
      } catch (err) {
        console.warn('Screenshot ' + s.id + ' could not be put in the sheet: ' + err);
        sh.getRange(s.row, s.keyCol + 1).setValue(s.id + ':pending');
        budget.pending++;
      }
    });
  }
}

function isCellImage_(v) {
  if (!v || typeof v !== 'object' || v instanceof Date) return false;
  return typeof v.toBuilder === 'function' ||
    (!!SpreadsheetApp.ValueType && v.valueType !== undefined && v.valueType === SpreadsheetApp.ValueType.IMAGE);
}

/** "fileId:kind" from the hidden key columns. */
function parseShotKey_(v) {
  const m = /^([\w-]{10,}):(thumb|full|pending|missing)$/.exec(String(v || ''));
  return m ? { id: m[1], kind: m[2] } : null;
}

/** 2026-10-01 -> 10-01-2026, like the Date cell of the old sheet. */
function monitorCheckDate_(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  return m ? m[2] + '-' + m[3] + '-' + m[1] : String(iso || '');
}

/** 2026-10-08 -> 10/8/2026, like Exp. Date and Birthday in the old sheet. Anything else as is. */
function monitorShortDate_(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v || '').trim());
  return m ? Number(m[2]) + '/' + Number(m[3]) + '/' + m[1] : String(v === undefined || v === null ? '' : v).trim();
}

/** 2.86, "2.86GB", "26.94GB AS OF 09/04/2026" or "500MB" -> gigabytes; null when not a number. */
function gigabytes_(v) {
  if (typeof v === 'number') return v;
  const m = /^\s*(\d+(?:\.\d+)?)\s*(gb|mb)?/i.exec(String(v || ''));
  if (!m) return null;
  return m[2] && m[2].toLowerCase() === 'mb' ? Number(m[1]) / 1024 : Number(m[1]);
}

/** Whole days from one ISO date to another; null unless both are ISO dates. */
function daysBetween_(fromIso, toIso) {
  const a = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(fromIso || ''));
  const b = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(toIso || ''));
  if (!a || !b) return null;
  return Math.round((Date.UTC(+b[1], +b[2] - 1, +b[3]) - Date.UTC(+a[1], +a[2] - 1, +a[3])) / 86400000);
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function tz_() {
  return Session.getScriptTimeZone() || 'Asia/Manila';
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function driversSheet_() {
  return ensureSheet_(CONFIG.DRIVERS_SHEET, DRIVER_FIELDS, []);
}

function checksSheet_() {
  return ensureSheet_(CONFIG.CHECKS_SHEET, CHECK_FIELDS, ['currentData']);
}

function requestsSheet_() {
  return ensureSheet_(CONFIG.REQUESTS_SHEET, REQUEST_FIELDS, []);
}

/** Creates the sheet with a red header row the first time. Columns are plain text except numberKeys. */
function ensureSheet_(name, fields, numberKeys) {
  const ss = spreadsheet_();
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, fields.length)
      .setValues([fields.map(function (f) { return f[1]; })])
      .setFontWeight('bold')
      .setBackground(CONFIG.HEADER_BG)
      .setFontColor(CONFIG.HEADER_FG);
    sh.setFrozenRows(1);
    const body = sh.getRange(2, 1, Math.max(sh.getMaxRows() - 1, 1), fields.length);
    body.setNumberFormat('@'); // keep dates, times and SIM numbers (leading 0) as typed
    numberKeys.forEach(function (key) {
      const col = fields.map(function (f) { return f[0]; }).indexOf(key) + 1;
      if (col > 0) sh.getRange(2, col, Math.max(sh.getMaxRows() - 1, 1), 1).setNumberFormat('0.00');
    });
  } else if (sh.getLastColumn() < fields.length) {
    // An older sheet is missing columns added later (e.g. Screenshot 2): add their headers.
    const first = sh.getLastColumn() + 1;
    const missing = fields.slice(first - 1);
    if (sh.getMaxColumns() < fields.length) sh.insertColumnsAfter(sh.getMaxColumns(), fields.length - sh.getMaxColumns());
    sh.getRange(1, first, 1, missing.length)
      .setValues([missing.map(function (f) { return f[1]; })])
      .setFontWeight('bold')
      .setBackground(CONFIG.HEADER_BG)
      .setFontColor(CONFIG.HEADER_FG);
    sh.getRange(2, first, Math.max(sh.getMaxRows() - 1, 1), missing.length).setNumberFormat('@');
  }
  return sh;
}

/* ---------- Data versions ---------- */

/** Short, URL-safe hash of any JSON-able value. */
function hash_(value) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, JSON.stringify(value), Utilities.Charset.UTF_8);
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/, '').slice(0, 16);
}

function rowValues_(row, fields) {
  return fields.map(function (f) { return row[f[0]]; });
}

/** Version of one check: its rows sorted by driver. '' when the date has no rows. */
function checkVersion_(checkRows, date) {
  const rows = checkRows
    .filter(function (r) { return String(r.date) === String(date); })
    .map(function (r) { return rowValues_(r, CHECK_FIELDS); })
    .sort(function (a, b) { return String(a[2]).localeCompare(String(b[2])); });
  return rows.length ? hash_(rows) : '';
}

function driverVersion_(driverRow) {
  return hash_(rowValues_(driverRow, DRIVER_FIELDS));
}

/** Version of everything the web app shows. Changes on any edit, including edits made in the sheet. */
function dataVersion_(driverRows, checkRows, requestRows) {
  return hash_([
    driverRows.map(function (r) { return rowValues_(r, DRIVER_FIELDS); }),
    checkRows.map(function (r) { return rowValues_(r, CHECK_FIELDS); }),
    (requestRows || []).map(function (r) { return rowValues_(r, REQUEST_FIELDS); }),
  ]);
}

/** Refuses a write when the caller's version is out of date. null/undefined skips the check. */
function assertVersion_(baseVersion, currentVersion, message) {
  if (baseVersion === null || baseVersion === undefined) return;
  if (String(baseVersion) !== currentVersion) {
    throw new Error('CONFLICT: ' + message + ' Reload to see the latest data.');
  }
}

function driveLink_(fileId) {
  return fileId ? 'https://drive.google.com/file/d/' + fileId + '/view' : '';
}

function readObjects_(sh, fields) {
  const last = sh.getLastRow();
  if (last < 2) return [];
  const values = sh.getRange(2, 1, last - 1, fields.length).getValues();
  const out = [];
  values.forEach(function (row, i) {
    if (row.every(function (v) { return v === '' || v === null; })) return;
    const obj = objectFromRow_(row, fields);
    obj._row = i + 2;
    out.push(obj);
  });
  return out;
}

function objectFromRow_(row, fields) {
  const obj = {};
  fields.forEach(function (f, c) { obj[f[0]] = cellToValue_(row[c]); });
  return obj;
}

/** google.script.run cannot return Date objects, so dates become strings. */
function cellToValue_(v) {
  if (v instanceof Date) {
    if (v.getFullYear() < 1901) return Utilities.formatDate(v, tz_(), 'h:mm a');
    return Utilities.formatDate(v, tz_(), 'yyyy-MM-dd');
  }
  return v === null || v === undefined ? '' : v;
}

function cleanDriver_(d) {
  const out = {};
  DRIVER_FIELDS.forEach(function (f) {
    const k = f[0];
    if (SHEET_ONLY_DRIVER_KEYS.indexOf(k) >= 0) return; // never sent to the web app
    if (k === 'active') out.active = !(d.active === false || String(d.active).toUpperCase() === 'FALSE');
    else if (k === 'sort') out.sort = Number(d.sort) || 0;
    else out[k] = d[k] === undefined || d[k] === null ? '' : String(d[k]);
  });
  return out;
}

function driverRow_(d) {
  return DRIVER_FIELDS.map(function (f) {
    const k = f[0];
    if (k === 'active') return d.active === false ? 'FALSE' : 'TRUE';
    if (k === 'sort') return String(Number(d.sort) || 0);
    return d[k] === undefined || d[k] === null ? '' : String(d[k]).trim();
  });
}

function toNumberOrText_(v) {
  const s = String(v === undefined || v === null ? '' : v).trim();
  if (s === '') return '';
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : s;
}

function isIsoDate_(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
}

function screenshotFolder_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty(CONFIG.FOLDER_PROPERTY);
  if (id) {
    try {
      const existing = DriveApp.getFolderById(id);
      if (!existing.isTrashed()) return existing;
    } catch (e) {
      // folder was deleted; make a new one below
    }
  }
  const folder = DriveApp.createFolder(CONFIG.SCREENSHOT_FOLDER_NAME);
  props.setProperty(CONFIG.FOLDER_PROPERTY, folder.getId());
  return folder;
}

/** Only files inside the screenshots folder can be read or trashed through the web app. */
function screenshotFile_(fileId) {
  if (!/^[\w-]{10,}$/.test(String(fileId || ''))) throw new Error('Unknown screenshot.');
  const folderId = screenshotFolder_().getId();
  const file = DriveApp.getFileById(fileId);
  const parents = file.getParents();
  while (parents.hasNext()) {
    if (parents.next().getId() === folderId) return file;
  }
  throw new Error('That file is not in the load screenshots folder.');
}
