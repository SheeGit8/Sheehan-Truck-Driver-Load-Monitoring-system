/**
 * Reads the old "SHEEHAN DRIVER LOAD MONITORING" spreadsheet so its history can be imported.
 *
 * Input: the sheet as CSV (File > Download > Comma-separated values) or as cells copied from
 * Google Sheets / Excel and pasted (tab-separated). Two layouts are understood:
 *
 *  1. The old monitoring sheet: one header row (Name, USER, Surname, Driver Emails, …,
 *     Current Data, …, Availed Load, Exp. Date, Exp. Time), then blocks that each start with
 *     an "Updated By: GAB   Date: 11-10-2026" row followed by one row per phone.
 *  2. A table with a Date (and Updated By) column on every row, e.g. the "Load Checks" tab.
 *
 * Columns are found by their header text, so their order doesn't matter. Passwords, Messenger
 * passwords and GOMO app PINs are never read.
 */

/* ---------- CSV / TSV ---------- */

/** Splits CSV or tab-separated text into rows of cells. Handles quoted cells with commas/newlines. */
export function parseTable(text) {
  const src = String(text || '').replace(/^\uFEFF/, '') // byte-order mark some .csv files start with
  // Pasted cells are tab-separated; a downloaded .csv uses commas (names like "CAPONPON, DARWIN" add a few).
  const sample = src.slice(0, 20000)
  const tabs = (sample.match(/\t/g) || []).length
  const commas = (sample.match(/,/g) || []).length
  const delim = tabs > 0 && tabs >= commas / 4 ? '\t' : ','

  const rows = []
  let row = []
  let cell = ''
  let quoted = false
  let atCellStart = true
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"'
          i++
        } else quoted = false
      } else cell += ch
      continue
    }
    if (ch === '"' && atCellStart) {
      quoted = true
      atCellStart = false
    } else if (ch === delim) {
      row.push(cell)
      cell = ''
      atCellStart = true
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
      atCellStart = true
    } else {
      cell += ch
      atCellStart = false
    }
  }
  if (cell !== '' || row.length) {
    row.push(cell)
    rows.push(row)
  }
  return rows.map((r) => r.map((c) => c.trim()))
}

/* ---------- Headers ---------- */

const norm = (s) => String(s ?? '').toLowerCase().replace(/[:#.()*]/g, ' ').replace(/\s+/g, ' ').trim()

/** Same key the backend uses to match drivers (Code.gs importData). */
export const driverKey = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim()

const ALIASES = {
  label: ['name', 'account name', 'account', 'phone name'],
  user: ['user', 'assigned driver', 'driver', 'driver name', 'assigned to'],
  surname: ['surname', 'last name'],
  email: ['driver emails', 'driver email', 'email', 'emails', 'email address'],
  birthday: ['birthday', 'birth date', 'birthdate'],
  recoveryEmail: ['recovery email', 'recovery emails'],
  brand: ['brand'],
  model: ['model'],
  phoneModel: ['phone model'],
  color: ['color', 'colour'],
  serial: ['serial', 'serial no', 'serial number'],
  sim: ['gomo sim', 'gomo sim no', 'sim', 'sim no', 'sim number', 'gomo number'],
  currentData: ['current data', 'current data gb', 'data', 'data left'],
  load: ['availed load', 'load', 'promo'],
  expDate: ['exp date', 'expiry date', 'expiration date', 'expiry'],
  expTime: ['exp time', 'expiry time', 'expiration time'],
  remarks: ['remarks', 'remark', 'notes', 'note'],
  date: ['date', 'check date'],
  updatedBy: ['updated by'],
}
/** Columns that hold secrets: recognised only so they're never mistaken for remarks. */
const SECRET = ['password', 'passwords', 'messenger password', 'gomo app pin', 'app pin', 'pin']

const FIELD_BY_HEADER = new Map()
for (const [field, names] of Object.entries(ALIASES)) for (const n of names) FIELD_BY_HEADER.set(n, field)

/** Maps a header row to { field: columnIndex }, or null when it doesn't look like a header. */
function readHeader(row) {
  const cols = {}
  let hits = 0
  row.forEach((cell, i) => {
    const field = FIELD_BY_HEADER.get(norm(cell))
    if (field && cols[field] === undefined) {
      cols[field] = i
      hits++
    }
  })
  const hasName = cols.label !== undefined || cols.user !== undefined
  const hasLoad = ['currentData', 'load', 'expDate'].some((f) => cols[f] !== undefined)
  if (!hasName || !hasLoad || hits < 3) return null
  const named = row.map((c) => norm(c) !== '')
  return { cols, named, secret: row.map((c) => SECRET.includes(norm(c))) }
}

/* ---------- Values ---------- */

const pad = (n) => String(n).padStart(2, '0')
const blank = (v) => {
  const s = String(v ?? '').trim()
  return s === '' || /^[-–—]+$/.test(s) || /^n\/?a$/i.test(s) ? '' : s
}
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

/** "11-10-2026", "11/17/2026", "2026-11-17", "Nov 17, 2026" -> "2026-11-17". '' if blank, null if not a date. */
export function toIsoDate(value) {
  const s = blank(value)
  if (!s) return ''
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s)
  if (m) return valid(+m[1], +m[2], +m[3])
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(s)
  if (m) {
    let [a, b] = [+m[1], +m[2]]
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3]
    if (a > 12 && b <= 12) [a, b] = [b, a] // day first, e.g. 25/11/2026
    return valid(y, a, b)
  }
  m = /^([a-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})$/i.exec(s) || null
  if (m) return valid(+m[3], MONTHS.indexOf(m[1].toLowerCase()) + 1, +m[2])
  m = /^(\d{1,2})\s+([a-z]{3})[a-z]*\.?,?\s+(\d{4})$/i.exec(s)
  if (m) return valid(+m[3], MONTHS.indexOf(m[2].toLowerCase()) + 1, +m[1])
  return null
}
function valid(y, mo, d) {
  if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= 31 && y >= 1900 && y <= 2200)) return null
  const dt = new Date(y, mo - 1, d)
  return dt.getMonth() === mo - 1 ? `${y}-${pad(mo)}-${pad(d)}` : null
}

/** "7:06 AM", "7:06:00 AM", "07:06", "19:06" -> "7:06 AM" / "7:06 PM". Other text is kept. */
export function toTime12(value) {
  const s = blank(value)
  if (!s) return ''
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?\s*([ap])\.?\s*m\.?$/i.exec(s)
  if (m) return `${+m[1] % 12 || 12}:${m[2]} ${m[3].toUpperCase()}M`
  const h = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(s)
  if (h && +h[1] < 24) return `${+h[1] % 12 || 12}:${h[2]} ${+h[1] < 12 ? 'AM' : 'PM'}`
  return s
}

/** "43.50 GB" -> "43.50". Text such as "26.94GB AS OF 09/04/2026" is kept as written. */
export function toData(value) {
  const s = blank(value)
  if (!s) return ''
  const m = /^(-?\d+(?:[.,]\d+)?)\s*(?:gb)?$/i.exec(s.replace(/,(?=\d{3}\b)/g, ''))
  return m ? m[1].replace(',', '.') : s
}

/** Keeps the leading 0 that spreadsheets drop: 9761500060 -> 09761500060. */
export function toSim(value) {
  const s = blank(value).replace(/[\s-]/g, '')
  if (/^9\d{9}$/.test(s)) return '0' + s
  if (/^639\d{9}$/.test(s)) return '0' + s.slice(2)
  return s
}

/* ---------- The import ---------- */

/**
 * @param {string[][]} rows   from parseTable()
 * @param {{ drivers: object[], checks: object[] }} current  what the app already has (getAppData)
 * @returns {{ drivers, checks, entries, warnings, ignoredSecrets, ok }}
 *   drivers: [{ key, label, user, …, status: 'new'|'existing', existingId }]
 *   checks:  [{ date, updatedBy, entries: [{ driverKey, currentData, load, expDate, expTime, remarks }], status: 'new'|'existing' }]
 */
export function readOldSheet(rows, current = { drivers: [], checks: [] }) {
  const warnings = []
  const warn = (rowIndex, text) => warnings.push(rowIndex === null ? text : `Row ${rowIndex + 1}: ${text}`)
  let header = null
  let block = { updatedBy: '', date: '' }
  let ignoredSecrets = false
  const driverInfo = new Map() // key -> { info, date, order }
  const checks = new Map() // date -> { date, updatedBy, entries: Map(key -> entry) }
  let order = 0

  rows.forEach((row, r) => {
    if (!row.some((c) => c !== '')) return

    // A header row (the first one, or a repeated one further down).
    const h = readHeader(row)
    if (h) {
      header = h
      if (h.secret.some(Boolean)) ignoredSecrets = true
      return
    }

    // "Updated By: | GAB | Date: | 11-10-2026" starts a block.
    const ub = row.findIndex((c) => norm(c) === 'updated by')
    if (ub >= 0) {
      const after = (i) => row.slice(i + 1).find((c) => c !== '') || ''
      const di = row.findIndex((c, i) => i !== ub && norm(c) === 'date')
      const date = di >= 0 ? toIsoDate(after(di)) : ''
      block = { updatedBy: after(ub) && norm(after(ub)) !== 'date' ? after(ub) : '', date: date || '' }
      if (di >= 0 && date === null) warn(r, `“${after(di)}” is not a date I can read. The rows under it are skipped.`)
      if (di < 0) warn(r, 'An “Updated By” row without a date. The rows under it are skipped.')
      return
    }

    if (!header) return // title rows above the header
    const get = (f) => (header.cols[f] === undefined ? '' : row[header.cols[f]] ?? '')
    const label = blank(get('label'))
    const user = blank(get('user'))
    if (!label && !user) return
    const key = driverKey(label || user)

    // Date: from the row (table layout) or from the block above it.
    let date = block.date
    let updatedBy = block.updatedBy
    if (header.cols.date !== undefined) {
      const d = toIsoDate(get('date'))
      if (d === null) {
        warn(r, `“${get('date')}” is not a date I can read. Row skipped.`)
        return
      }
      if (d) date = d
    }
    if (header.cols.updatedBy !== undefined && blank(get('updatedBy'))) updatedBy = blank(get('updatedBy'))

    const birthday = toIsoDate(get('birthday'))
    const info = {
      key,
      label: label || user,
      user: user || label,
      surname: blank(get('surname')),
      email: blank(get('email')),
      birthday: birthday === null ? blank(get('birthday')) : birthday,
      recoveryEmail: blank(get('recoveryEmail')),
      brand: blank(get('brand')),
      model: blank(get('model')) || blank(get('phoneModel')),
      color: blank(get('color')),
      serial: blank(get('serial')),
      sim: toSim(get('sim')),
    }
    const known = driverInfo.get(key)
    if (!known) driverInfo.set(key, { info, date, order: order++ })
    else if (!known.date || (date && date >= known.date)) driverInfo.set(key, { info, date, order: known.order })

    if (!date) return // a phone list without a check date: import the driver only

    // Remarks: the Remarks column, or notes typed in columns that have no header (column T).
    const extra = row
      .map((c, i) => (i !== header.cols.remarks && !header.named[i] && !header.secret[i] && !Object.values(header.cols).includes(i) ? blank(c) : ''))
      .filter(Boolean)
    const remarks = [blank(get('remarks')), ...extra].filter(Boolean).join(' · ')

    const expDate = toIsoDate(get('expDate'))
    if (expDate === null) warn(r, `Expiry date “${get('expDate')}” for ${info.label} is not a date I can read. Imported without it.`)
    const entry = {
      driverKey: key,
      currentData: toData(get('currentData')),
      load: blank(get('load')),
      expDate: expDate || '',
      expTime: toTime12(get('expTime')),
      remarks,
    }
    if (!entry.currentData && !entry.load && !entry.expDate && !entry.expTime && !entry.remarks) return

    if (!checks.has(date)) checks.set(date, { date, updatedBy: '', entries: new Map() })
    const check = checks.get(date)
    if (updatedBy && !check.updatedBy) check.updatedBy = updatedBy
    if (check.entries.has(key)) warn(r, `${info.label} appears twice on ${date}. The lower row is used.`)
    check.entries.set(key, entry)
  })

  if (!header) warn(null, 'No header row found. The sheet needs a row with column names such as Name, USER, Current Data and Availed Load.')

  // Match with drivers already in the app: account name, then email, then serial number.
  const byKey = new Map()
  const byEmail = new Map()
  const bySerial = new Map()
  for (const d of current.drivers || []) {
    byKey.set(driverKey(d.label), d)
    if (d.email) byEmail.set(d.email.toLowerCase(), d)
    if (d.serial) bySerial.set(d.serial.toLowerCase(), d)
  }
  const drivers = [...driverInfo.values()]
    .sort((a, b) => a.order - b.order)
    .map(({ info }) => {
      const match = byKey.get(info.key) || (info.email && byEmail.get(info.email.toLowerCase())) || (info.serial && bySerial.get(info.serial.toLowerCase()))
      return { ...info, status: match ? 'existing' : 'new', existingId: match?.id || '' }
    })

  const existingDates = new Set((current.checks || []).map((c) => c.date))
  const checkList = [...checks.values()]
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((c) => ({ date: c.date, updatedBy: c.updatedBy, entries: [...c.entries.values()], status: existingDates.has(c.date) ? 'existing' : 'new' }))

  const entries = checkList.reduce((n, c) => n + c.entries.length, 0)
  return { drivers, checks: checkList, entries, warnings, ignoredSecrets, ok: drivers.length > 0 }
}

/** What gets sent to the backend: only new checks, and the drivers they (or the user) need. */
export function importPayload(result) {
  const drivers = result.drivers.map((d, i) => ({
    key: d.key,
    label: d.label,
    user: d.user,
    surname: d.surname,
    email: d.email,
    birthday: d.birthday,
    recoveryEmail: d.recoveryEmail,
    brand: d.brand,
    model: d.model,
    color: d.color,
    serial: d.serial,
    sim: d.sim,
    order: i,
    tracker: /tracker/i.test(`${d.label} ${d.user}`),
  }))
  const checks = result.checks.filter((c) => c.status === 'new').map(({ date, updatedBy, entries }) => ({ date, updatedBy, entries }))
  return { drivers, checks }
}
