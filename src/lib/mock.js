/**
 * Demo backend used outside Apps Script (npm run dev). Same functions and shapes as
 * apps-script/Code.gs, seeded with the two checks from the old monitoring sheet.
 * Data lives in this browser's localStorage; "Reset demo data" in the footer clears it.
 */
import { DEFAULT_LOAD } from './format.js'

const KEY = 'slm-demo-v1'
const delay = (ms = 250) => new Promise((r) => setTimeout(r, ms))
const clone = (v) => JSON.parse(JSON.stringify(v))

const BASE = {
  surname: 'Sheehan', birthday: '2000-01-01', recoveryEmail: 'it@sheehan.com.ph',
  brand: 'Samsung', model: 'Galaxy A07', color: 'Black', active: true,
}

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
].map((d) => ({ ...BASE, ...d }))

// [driverId, currentData, expDate, expTime, remarks]
const NOV_10 = [
  ['drv-01', 43.5, '2026-11-17', '7:06 AM'],
  ['drv-02', 10.46, '2026-11-17', '7:07 AM'],
  ['drv-03', 40.61, '2026-11-17', '7:08 AM'],
  ['drv-04', 50.61, '2026-11-17', '7:10 AM'],
  ['drv-05', 2.65, '2026-11-10', '7:16 AM', 'Not enough DATA'],
  ['drv-06', 40.21, '2026-11-17', '7:14 AM'],
  ['drv-07', 37.1, '2026-11-17', '7:15 AM'],
  ['drv-08', 4.74, '2026-11-17', '7:16 AM'],
]
const NOV_18 = [
  ['drv-01', 38.13, '2026-11-25', '7:08 AM'],
  ['drv-02', 4.21, '2026-11-25', '7:12 AM'],
  ['drv-03', 34.07, '2026-11-25', '7:14 AM'],
  ['drv-04', 47.31, '2026-11-25', '7:15 AM'],
  ['drv-05', 54.98, '2026-11-25', '7:18 AM', 'Not enough DATA'],
  ['drv-06', 34.65, '2026-11-25', '7:10 AM'],
  ['drv-07', 30.7, '2026-11-25', '7:21 AM'],
  ['drv-08', 1.74, '2026-11-25', '7:22 AM'],
]

/** A plain placeholder image so the screenshot viewer has something to show in the demo. */
function sampleShot(...lines) {
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const [title, big, line1, line2] = lines.map(esc)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="540" height="1170" viewBox="0 0 540 1170">
<rect width="540" height="1170" fill="#f4f4f5"/>
<rect x="0" y="0" width="540" height="96" fill="#18181b"/>
<text x="32" y="60" font-family="Arial" font-size="28" font-weight="700" fill="#fafafa">${title}</text>
<rect x="32" y="140" width="476" height="300" rx="24" fill="#ffffff" stroke="#e4e4e7" stroke-width="2"/>
<text x="64" y="210" font-family="Arial" font-size="26" fill="#71717a">${line1}</text>
<text x="64" y="320" font-family="Arial" font-size="84" font-weight="700" fill="#18181b">${big}</text>
<text x="64" y="395" font-family="Arial" font-size="24" fill="#71717a">${line2}</text>
<rect x="32" y="480" width="476" height="56" rx="12" fill="#e4e4e7"/>
<rect x="32" y="560" width="360" height="56" rx="12" fill="#e4e4e7"/>
<text x="270" y="1100" text-anchor="middle" font-family="Arial" font-size="22" fill="#a1a1aa">Sample screenshot · demo data</text>
</svg>`
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
}

function buildSeed() {
  const files = {}
  const entry = (date, withShots) => ([driverId, gb, expDate, expTime, remarks = '']) => {
    const e = { driverId, currentData: String(gb), load: DEFAULT_LOAD, expDate, expTime, remarks, screenshotId: '', screenshot2Id: '' }
    if (withShots) {
      e.screenshotId = `demo-${date}-${driverId}-1`
      e.screenshot2Id = `demo-${date}-${driverId}-2`
      files[e.screenshotId] = sampleShot('Data balance', `${gb.toFixed(2)} GB`, 'Data left', `Checked ${date}`)
      files[e.screenshot2Id] = sampleShot('Active promo', '7 days', DEFAULT_LOAD, `Ends ${expDate} ${expTime}`)
    }
    return e
  }
  const tracker = { driverId: 'tracker', currentData: '26.94GB AS OF 09/04/2026', load: '', expDate: '', expTime: '', remarks: '', screenshotId: '', screenshot2Id: '' }
  return {
    drivers: SEED_DRIVERS,
    checks: [
      { date: '2026-11-18', updatedBy: 'GAB', entries: [...NOV_18.map(entry('2026-11-18', true)), tracker] },
      { date: '2026-11-10', updatedBy: 'GAB', entries: [...NOV_10.map(entry('2026-11-10', false)), tracker] },
    ],
    files,
  }
}

let state = null
let memoryOnly = false // true once localStorage refused a write; then memory is the only copy

/** Same idea as hash_() in Code.gs: a short hash of the rows, used as a data version. */
function versionOf(value) {
  const str = JSON.stringify(value)
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}
const checkVersion = (c) => (c ? versionOf([c.updatedBy, [...c.entries].sort((a, b) => a.driverId.localeCompare(b.driverId))]) : '')
const dataVersion = (s) => versionOf([s.drivers, s.checks.map(checkVersion), demoRequests(s)])

/** In the demo nobody is on Telegram, so "HR" marks each request loaded after a short wait. */
const DEMO_HR_DELAY_MS = 30_000
const stamp = (d) => {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
function demoRequests(s) {
  if (!s.requests) s.requests = []
  for (const r of s.requests) {
    if (r.status === 'Requested' && Date.now() - r._sentAt > DEMO_HR_DELAY_MS) {
      r.status = 'Done'
      r.doneBy = 'HR (demo)'
      r.doneAt = stamp(new Date(r._sentAt + DEMO_HR_DELAY_MS))
    }
  }
  return s.requests.map(({ _sentAt, ...r }) => r) // eslint-disable-line no-unused-vars
}

function assertVersion(baseVersion, current, message) {
  if (baseVersion === null || baseVersion === undefined) return
  if (baseVersion !== current) throw new Error(`CONFLICT: ${message} Reload to see the latest data.`)
}

/** Re-reads localStorage so changes made in another tab are seen, like a shared sheet. */
function fresh() {
  if (!memoryOnly) state = null
  return db()
}

function db() {
  if (state) return state
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) state = JSON.parse(raw)
  } catch {
    state = null
  }
  if (!state) state = buildSeed()
  return state
}

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
  } catch {
    // Storage full (screenshots are large) — keep working from memory for this session.
    memoryOnly = true
  }
}

export function resetDemo() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
  state = null
  memoryOnly = false
}

export const mockApi = {
  async getAppData() {
    await delay(350)
    const s = fresh()
    return {
      drivers: clone(s.drivers).map((d) => ({ ...d, version: versionOf(d) })).sort((a, b) => a.sort - b.sort),
      checks: clone(s.checks).map((c) => ({ ...c, version: checkVersion(c) })).sort((a, b) => b.date.localeCompare(a.date)),
      requests: clone(demoRequests(s)).reverse(),
      telegram: true,
      dataVersion: dataVersion(s),
    }
  },

  async getDataVersion() {
    await delay(80)
    return dataVersion(fresh())
  },

  async saveCheck(check, baseVersion = null) {
    await delay()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(check?.date || '')) throw new Error('The check needs a date like 2026-11-18.')
    const s = fresh()
    const existing = s.checks.find((c) => c.date === check.date)
    assertVersion(baseVersion, checkVersion(existing), `The ${check.date} load check was changed by someone else after you opened it.`)
    const entries = clone(check.entries || [])
    if (existing) {
      existing.updatedBy = check.updatedBy || ''
      for (const e of entries) {
        const i = existing.entries.findIndex((x) => x.driverId === e.driverId)
        if (i >= 0) existing.entries[i] = e
        else existing.entries.push(e)
      }
    } else {
      s.checks.push({ date: check.date, updatedBy: check.updatedBy || '', entries })
    }
    persist()
    return { savedAt: new Date().toISOString(), dataVersion: dataVersion(s) }
  },

  async deleteCheck(date, baseVersion = null) {
    await delay()
    const s = fresh()
    assertVersion(baseVersion, checkVersion(s.checks.find((c) => c.date === date)), `The ${date} load check was changed by someone else after you opened it.`)
    const before = s.checks.length
    s.checks = s.checks.filter((c) => c.date !== date)
    persist()
    return { deleted: before - s.checks.length, dataVersion: dataVersion(s) }
  },

  async saveDriver(driver, baseVersion = null) {
    await delay()
    if (!String(driver?.label || '').trim()) throw new Error('Enter an account name, like "Driver Nine".')
    if (!String(driver?.user || '').trim()) throw new Error("Enter the assigned driver's name.")
    const s = fresh()
    const d = { ...driver }
    delete d.version
    delete d.dataVersion
    if (d.id) {
      const match = s.drivers.find((x) => x.id === d.id)
      assertVersion(baseVersion, match ? versionOf(match) : '', `${match?.label || 'This driver'} was changed by someone else after you opened it.`)
    }
    if (!d.id) {
      d.id = 'drv-' + Math.random().toString(16).slice(2, 10)
      const sorts = s.drivers.map((x) => Number(x.sort) || 0).filter((n) => n < 100)
      d.sort = (sorts.length ? Math.max(...sorts) : 0) + 1
      if (d.active === undefined) d.active = true
    }
    const i = s.drivers.findIndex((x) => x.id === d.id)
    if (i >= 0) s.drivers[i] = d
    else s.drivers.push(d)
    persist()
    return { ...clone(d), version: versionOf(d), dataVersion: dataVersion(s) }
  },

  /** Same rules as importData() in Code.gs: add only, existing drivers and dates are left alone. */
  async importData(payload) {
    await delay(500)
    const s = fresh()
    const key = (v) => String(v || '').toLowerCase().replace(/\s+/g, ' ').trim()
    const idByKey = {}
    let matched = 0
    let added = 0
    let low = Math.max(0, ...s.drivers.map((d) => Number(d.sort) || 0).filter((n) => n < 100))
    let high = Math.max(99, ...s.drivers.map((d) => Number(d.sort) || 0).filter((n) => n >= 100))
    for (const d of payload?.drivers || []) {
      const k = key(d.key || d.label || d.user)
      if (!k || idByKey[k]) continue
      const match = s.drivers.find((x) => key(x.label) === key(d.label) || (d.email && key(x.email) === key(d.email)) || (d.serial && key(x.serial) === key(d.serial)))
      if (match) {
        idByKey[k] = match.id
        matched++
        continue
      }
      const rec = {
        id: 'drv-' + Math.random().toString(16).slice(2, 10),
        label: d.label || d.user, user: d.user || d.label, surname: d.surname || '', email: d.email || '',
        birthday: d.birthday || '', recoveryEmail: d.recoveryEmail || '', brand: d.brand || '', model: d.model || '',
        color: d.color || '', serial: d.serial || '', sim: d.sim || '', active: true,
        sort: d.tracker ? ++high : ++low,
      }
      s.drivers.push(rec)
      idByKey[k] = rec.id
      added++
    }
    const taken = new Set(s.checks.map((c) => c.date))
    const addedDates = []
    const skipped = []
    let rows = 0
    for (const c of payload?.checks || []) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(c?.date || '')) continue
      if (taken.has(c.date)) {
        skipped.push(c.date)
        continue
      }
      const seen = new Set()
      const entries = []
      for (const e of c.entries || []) {
        const id = idByKey[key(e.driverKey)]
        if (!id || seen.has(id)) continue
        seen.add(id)
        entries.push({ driverId: id, currentData: String(e.currentData ?? ''), load: e.load || '', expDate: e.expDate || '', expTime: e.expTime || '', remarks: e.remarks || '', screenshotId: '', screenshot2Id: '' })
      }
      if (!entries.length) continue
      s.checks.push({ date: c.date, updatedBy: c.updatedBy || '', entries })
      taken.add(c.date)
      addedDates.push(c.date)
      rows += entries.length
    }
    persist()
    return { driversAdded: added, driversMatched: matched, checksAdded: addedDates.length, checksSkipped: skipped, rowsAdded: rows, dataVersion: dataVersion(s) }
  },

  /** Same checks as requestLoad() in Code.gs; nothing is sent anywhere in the demo. */
  async requestLoad({ driverId, requestedBy, note } = {}) {
    await delay(600)
    if (!String(requestedBy || '').trim()) throw new Error('Enter your name so HR knows who asked.')
    const s = fresh()
    const driver = s.drivers.find((d) => d.id === driverId)
    if (!driver) throw new Error('That phone is no longer in the Drivers list. Reload and try again.')
    const open = demoRequests(s).find((r) => r.driverId === driverId && r.status === 'Requested')
    if (open) throw new Error(`Load for ${driver.label} was already requested (${open.requestedAt} by ${open.requestedBy}).`)
    let latest = null
    for (const c of [...s.checks].sort((a, b) => b.date.localeCompare(a.date))) {
      const e = c.entries.find((x) => x.driverId === driverId)
      if (e) {
        latest = { ...e, date: c.date }
        break
      }
    }
    const now = new Date()
    const req = {
      id: 'req-' + Math.random().toString(16).slice(2, 10),
      requestedAt: stamp(now),
      requestedBy: String(requestedBy).trim(),
      driverId,
      driverLabel: driver.label,
      driverName: driver.user,
      sim: driver.sim || '',
      currentData: latest ? String(latest.currentData ?? '') : '',
      load: latest?.load || '',
      expires: latest?.expDate || '',
      checkDate: latest?.date || '',
      screenshotId: latest?.screenshotId || latest?.screenshot2Id || '',
      note: String(note || '').trim(),
      status: 'Requested',
      doneAt: '',
      doneBy: '',
      _sentAt: now.getTime(),
    }
    s.requests.push(req)
    persist()
    const { _sentAt, ...out } = req // eslint-disable-line no-unused-vars
    return { request: out, photo: !!req.screenshotId, dataVersion: dataVersion(s) }
  },

  async uploadScreenshot({ dataUrl, date, driverId, slot }) {
    await delay(400)
    const s = db()
    const id = `demo-${date}-${driverId}-${slot}-${Date.now().toString(36)}`
    s.files[id] = dataUrl
    persist()
    return { fileId: id }
  },

  async getScreenshot(fileId) {
    await delay(150)
    const url = db().files[fileId]
    if (!url) throw new Error('Screenshot not found.')
    return url
  },

  async getScreenshotThumb(fileId) {
    return mockApi.getScreenshot(fileId) // the demo has no separate small versions
  },

  async removeScreenshot(fileId) {
    await delay(100)
    delete db().files[fileId]
    persist()
    return true
  },
}
