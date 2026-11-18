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
 * Each load check entry can carry 2 screenshots from the GOMO app. They are saved as
 * image files in the Drive folder "Sheehan Load Screenshots".
 *
 * Data versions: getAppData() returns a `dataVersion` for the whole data set, plus a `version` on
 * every check and driver. Each is a short hash of the rows behind it, so it also changes when
 * someone edits the sheet by hand. The web app polls getDataVersion() to notice changes, and sends
 * the version it last saw with every save. If the rows changed in the meantime, the save is refused
 * with a message starting "CONFLICT:" instead of overwriting the other person's work.
 *
 * Account passwords, Messenger passwords and GOMO app PINs are intentionally NOT stored
 * here, because everyone who can open the web app can read what it stores.
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

/* ================================================================== */

const CONFIG = {
  DRIVERS_SHEET: 'Drivers',
  CHECKS_SHEET: 'Load Checks',
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
];

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

  return { drivers: drivers, checks: checks, dataVersion: dataVersion_(driverRows, checkRows) };
}

/** Cheap poll: the current data version, so the web app can tell whether anything changed. */
function getDataVersion() {
  return dataVersion_(readObjects_(driversSheet_(), DRIVER_FIELDS), readObjects_(checksSheet_(), CHECK_FIELDS));
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
/* "Load Monitoring" tab: the old monitoring sheet's layout, rebuilt   */
/* from Drivers + Load Checks after every save                         */
/* ------------------------------------------------------------------ */

/** Rows 1-3 hold the title band and the column headers. */
const MONITOR_FIRST_ROW_ = 4;

/**
 * Columns of the "Load Monitoring" tab, in the order of the old SHEEHAN DRIVER LOAD MONITORING sheet.
 * Password, Messenger Password and GOMO APP PIN are left out because they are never stored.
 * The last three are hidden bookkeeping: the row's driver ID (or "check:<date>" on an "Updated By" row)
 * and which Drive file each picture came from, so pictures already in the sheet aren't fetched again.
 */
const MONITOR_COLUMNS = [
  { key: 'label', title: 'Name:', width: 105, align: 'left' },
  { key: 'user', title: 'USER', width: 235, align: 'left' },
  { key: 'surname', title: 'Surname:', width: 70, align: 'left' },
  { key: 'email', title: 'Driver Emails:', width: 240, align: 'center' },
  { key: 'birthday', title: 'Birthday:', width: 75, align: 'right' },
  { key: 'recoveryEmail', title: 'Recovery Email:', width: 120, align: 'left' },
  { key: 'currentData', title: 'Current Data:', width: 190, align: 'center' },
  { key: 'brand', title: 'BRAND', width: 110, align: 'center' },
  { key: 'model', title: 'MODEL', width: 90, align: 'center' },
  { key: 'color', title: 'COLOR', width: 85, align: 'center' },
  { key: 'serial', title: 'SERIAL #', width: 100, align: 'center' },
  { key: 'sim', title: 'GOMO SIM#', width: 100, align: 'center' },
  { key: 'load', title: 'Availed Load:', width: 150, align: 'center' },
  { key: 'expDate', title: 'Exp. Date', width: 80, align: 'center' },
  { key: 'expTime', title: 'Exp. Time', width: 70, align: 'center' },
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
  const sh = monitorSheet_();
  const first = MONITOR_FIRST_ROW_;
  const width = MONITOR_COLUMNS.length;

  // Pictures already in the tab, by Drive file ID, so they're reused instead of fetched again.
  const known = {};
  const oldLast = sh.getLastRow();
  if (oldLast >= first) {
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

    rows.push(monitorRow_()); // blank line between checks
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
    sh.getRange(first, 1, oldLast - first + 1, sh.getMaxColumns()).clear();
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

/** Creates the tab the first time, and (re)writes the title band and headers like the old sheet. */
function monitorSheet_() {
  const ss = spreadsheet_();
  let sh = ss.getSheetByName(CONFIG.MONITOR_SHEET);
  const created = !sh;
  if (created) sh = ss.insertSheet(CONFIG.MONITOR_SHEET, 0);
  const width = MONITOR_COLUMNS.length;
  if (sh.getMaxColumns() < width) sh.insertColumnsAfter(sh.getMaxColumns(), width - sh.getMaxColumns());

  if (created) {
    // Only the first time, so column widths someone changes by hand are kept.
    MONITOR_COLUMNS.forEach(function (c, i) { sh.setColumnWidth(i + 1, c.width); });
    sh.setRowHeight(1, 8);
    sh.setRowHeight(2, 28);
    sh.setRowHeight(3, 21);
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
    .setValues([MONITOR_COLUMNS.map(function (c) { return c.title; })])
    .setBackground(C.header)
    .setFontWeight('bold')
    .setHorizontalAlignment('center');
  sh.getRange(3, 1, 1, MONITOR_VISIBLE_)
    .setBorder(true, true, true, true, true, true, '#000000', SpreadsheetApp.BorderStyle.SOLID);
  sh.setFrozenRows(3);
  sh.hideColumns(MONITOR_VISIBLE_ + 1, width - MONITOR_VISIBLE_);
  return sh;
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
  ['brand', 'model', 'color', 'serial', 'sim'].forEach(function (k) { v[MON_[k]] = text(d[k]); });
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
function dataVersion_(driverRows, checkRows) {
  return hash_([
    driverRows.map(function (r) { return rowValues_(r, DRIVER_FIELDS); }),
    checkRows.map(function (r) { return rowValues_(r, CHECK_FIELDS); }),
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
