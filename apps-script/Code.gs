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
