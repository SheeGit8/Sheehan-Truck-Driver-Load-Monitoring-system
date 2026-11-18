/**
 * Sheehan Driver Load Monitoring — Apps Script backend
 *
 * How to install (details in README.md):
 *   1. Open the Google Sheet > Extensions > Apps Script.
 *   2. Paste this file into Code.gs, and add an HTML file named "Index" with Index.html.
 *   3. Pick `setup` in the function list and press Run once (it creates the sheets,
 *      the screenshot folder, and the starting driver list).
 *   4. Deploy > New deployment > Web app.
 *
 * Sheets used:
 *   "Drivers"      one row per phone / driver account
 *   "Load Checks"  one row per driver per check date
 * Screenshots are saved as JPG files in the Drive folder "Sheehan Load Screenshots".
 *
 * Account passwords, Messenger passwords and GOMO app PINs are intentionally NOT stored
 * here, because everyone who can open the web app can read what it stores.
 */

const CONFIG = {
  DRIVERS_SHEET: 'Drivers',
  CHECKS_SHEET: 'Load Checks',
  SCREENSHOT_FOLDER_NAME: 'Sheehan Load Screenshots',
  FOLDER_PROPERTY: 'SCREENSHOT_FOLDER_ID',
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
  ['screenshotId', 'Screenshot File ID'],
  ['screenshotUrl', 'Screenshot Link'],
  ['savedAt', 'Saved At'],
];

const ENTRY_KEYS = ['driverId', 'currentData', 'load', 'expDate', 'expTime', 'remarks', 'screenshotId'];

const SEED_DRIVERS = [
  { id: 'drv-01', label: 'Driver One', user: 'CAPONPON, DARWIN ARANZA', email: 'sheehan.driverone.loading@gmail.com', serial: 'R83L2087YJL', sim: '09761500060', sort: 1 },
  { id: 'drv-02', label: 'Driver Two', user: 'CAPONPON, MARK JOSEPH ARANZA', email: 'sheehan.drivertwo.loading@gmail.com', serial: 'R83L1124QQM', sim: '09763901062', sort: 2 },
  { id: 'drv-03', label: 'Driver Three', user: 'ALVAREZ, KIM JERRY MADRONA', email: 'sheehan.driverthree.loading@gmail.com', serial: 'R83L1124QBH', sim: '09766699450', sort: 3 },
  { id: 'drv-04', label: 'Driver Four', user: 'PAMESA, RICHARD PRANADA', email: 'sheehan.driverfour.loading@gmail.com', serial: 'R83L40MR4GK', sim: '09762559479', sort: 4 },
  { id: 'drv-05', label: 'Driver Five', user: 'AUSA, JACKSON MONTERO', email: 'sheehan.driverfive.loading@gmail.com', serial: 'R83L40MVTEB', sim: '09765320041', sort: 5 },
  { id: 'drv-06', label: 'Driver Six', user: 'BANZUELA, JOEMARI', email: 'sheehan.driversix.loading@gmail.com', serial: 'R83L40MVXAR', sim: '09765252911', sort: 6 },
  { id: 'drv-07', label: 'Driver Seven', user: 'ARSOLON, JEFFRY MONCELLER', email: 'sheehan.driverseven.loading@gmail.com', serial: 'R83L40YHMCB', sim: '09763202443', birthday: '2000-01-02', sort: 7 },
  { id: 'drv-08', label: 'Driver Eight', user: 'CABELA, ROGEN', email: 'sheehan.drivereight.loading@gmail.com', serial: 'R83L70YN8EE', sim: '09760976880', sort: 8 },
  { id: 'tracker', label: 'Tracker Phone', user: 'INFORMATION TECH', surname: 'N/A', email: 'sheehan.tracker@gmail.com', model: 'Galaxy A06 5G', color: 'Sky Blue', serial: 'R7AY9003WZE', sim: '09760661912', sort: 100 },
].map(function (d) {
  return Object.assign({
    surname: 'Sheehan', birthday: '2000-01-01', recoveryEmail: 'it@sheehan.com.ph',
    brand: 'Samsung', model: 'Galaxy A07', color: 'Black', active: true,
  }, d);
});

/* ------------------------------------------------------------------ */
/* Web app entry                                                       */
/* ------------------------------------------------------------------ */

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Sheehan Driver Load Monitoring')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** Run once from the editor. Safe to run again: it never overwrites existing rows. */
function setup() {
  const drivers = driversSheet_();
  checksSheet_();
  const folder = screenshotFolder_();
  if (drivers.getLastRow() < 2) {
    const rows = SEED_DRIVERS.map(driverRow_);
    drivers.getRange(2, 1, rows.length, DRIVER_FIELDS.length).setValues(rows);
  }
  Logger.log('Setup complete. Screenshots folder: ' + folder.getUrl());
}

/* ------------------------------------------------------------------ */
/* API called from Index.html with google.script.run                   */
/* ------------------------------------------------------------------ */

function getAppData() {
  const drivers = readObjects_(driversSheet_(), DRIVER_FIELDS)
    .map(cleanDriver_)
    .sort(function (a, b) { return a.sort - b.sort; });

  const byDate = {};
  readObjects_(checksSheet_(), CHECK_FIELDS).forEach(function (row) {
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
    .map(function (d) { return byDate[d]; });

  return { drivers: drivers, checks: checks };
}

/** Creates or updates every row of one check (one date). */
function saveCheck(check) {
  if (!check || !isIsoDate_(check.date)) throw new Error('The check needs a date like 2026-11-18.');
  const entries = Array.isArray(check.entries) ? check.entries : [];

  return withLock_(function () {
    const sh = checksSheet_();
    const existing = readObjects_(sh, CHECK_FIELDS);
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
        screenshotUrl: screenshotId ? 'https://drive.google.com/file/d/' + screenshotId + '/view' : '',
        savedAt: savedAt,
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
    return { savedAt: savedAt };
  });
}

/** Deletes every row of one check. Screenshot files stay in Drive. */
function deleteCheck(date) {
  if (!isIsoDate_(date)) throw new Error('Unknown check date.');
  return withLock_(function () {
    const sh = checksSheet_();
    const rows = readObjects_(sh, CHECK_FIELDS)
      .filter(function (r) { return String(r.date) === date; })
      .map(function (r) { return r._row; })
      .sort(function (a, b) { return b - a; });
    rows.forEach(function (r) { sh.deleteRow(r); });
    return { deleted: rows.length };
  });
}

/** Adds a new driver (no id) or updates an existing one. Returns the saved driver. */
function saveDriver(driver) {
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

    const values = driverRow_(d);
    const match = rows.filter(function (r) { return r.id === d.id; })[0];
    if (match) {
      sh.getRange(match._row, 1, 1, values.length).setValues([values]);
    } else {
      sh.getRange(sh.getLastRow() + 1, 1, 1, values.length).setValues([values]);
    }
    return cleanDriver_(objectFromRow_(values, DRIVER_FIELDS));
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
  const blob = Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], date + ' ' + label + '.' + ext);

  const file = screenshotFolder_().createFile(blob);
  file.setDescription('Load check ' + date + ' for ' + label);
  return { fileId: file.getId() };
}

/** Returns a screenshot as a data URL, so the files can stay private in Drive. */
function getScreenshot(fileId) {
  const blob = screenshotFile_(fileId).getBlob();
  return 'data:' + blob.getContentType() + ';base64,' + Utilities.base64Encode(blob.getBytes());
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
  const ss = SpreadsheetApp.getActiveSpreadsheet();
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
  }
  return sh;
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
