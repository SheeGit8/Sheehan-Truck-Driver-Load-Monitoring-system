/** Below this many GB a phone is flagged "Low data" (the pink cells in the old sheet). */
export const LOW_DATA_GB = 5
/** A promo that ends within this many days is flagged "Expiring". */
export const EXPIRING_DAYS = 2

export const DEFAULT_LOAD = 'UNLI C&T 7DAYS (3GB)'
export const PROMO_DAYS = 7

const pad = (n) => String(n).padStart(2, '0')

export function todayIso() {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function nowTime12() {
  const d = new Date()
  return to12h(`${pad(d.getHours())}:${pad(d.getMinutes())}`)
}

function parseIso(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '')
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null
}

export function addDays(iso, days) {
  const d = parseIso(iso)
  if (!d) return ''
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function daysBetween(fromIso, toIso) {
  const a = parseIso(fromIso)
  const b = parseIso(toIso)
  if (!a || !b) return null
  return Math.round((b - a) / 86400000)
}

export function formatDate(iso, { withYear = true, weekday = false } = {}) {
  const d = parseIso(iso)
  if (!d) return iso || '—'
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(withYear ? { year: 'numeric' } : {}),
    ...(weekday ? { weekday: 'short' } : {}),
  })
}

/** "7:06 AM" -> "07:06" for <input type="time"> */
export function to24h(t) {
  const m = /^(\d{1,2}):(\d{2})\s*([AP]M)?$/i.exec(String(t || '').trim())
  if (!m) return ''
  let h = Number(m[1])
  const ap = (m[3] || '').toUpperCase()
  if (ap === 'PM' && h < 12) h += 12
  if (ap === 'AM' && h === 12) h = 0
  return `${pad(h)}:${m[2]}`
}

/** "07:06" -> "7:06 AM", the format the sheet already uses */
export function to12h(t) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || '').trim())
  if (!m) return String(t || '')
  const h = Number(m[1])
  return `${h % 12 || 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`
}

/** "38.13", 38.13 or "26.94GB AS OF 09/04/2026" -> 38.13 / 26.94. Returns null when empty. */
export function parseGb(v) {
  if (v === '' || v === null || v === undefined) return null
  const n = parseFloat(String(v).replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

export function formatGb(v) {
  if (v === '' || v === null || v === undefined) return '—'
  const s = String(v).trim()
  if (/^-?\d+(\.\d+)?$/.test(s)) return `${Number(s).toFixed(2)} GB`
  return s
}

/**
 * Health of one load entry, judged against `today`.
 * data:   'low' | 'ok' | 'none'
 * expiry: 'expired' | 'soon' | 'active' | 'none'
 */
export function entryStatus(entry, today = todayIso()) {
  if (!entry) return { data: 'none', expiry: 'none', daysLeft: null, gb: null }
  const gb = parseGb(entry.currentData)
  const data = gb === null ? 'none' : gb < LOW_DATA_GB ? 'low' : 'ok'
  const daysLeft = entry.expDate ? daysBetween(today, entry.expDate) : null
  let expiry = 'none'
  if (daysLeft !== null) expiry = daysLeft < 0 ? 'expired' : daysLeft <= EXPIRING_DAYS ? 'soon' : 'active'
  return { data, expiry, daysLeft, gb }
}

export function expiryText(daysLeft) {
  if (daysLeft === null) return ''
  if (daysLeft < 0) return `${-daysLeft}d ago`
  if (daysLeft === 0) return 'today'
  if (daysLeft === 1) return 'tomorrow'
  return `in ${daysLeft}d`
}

/** For each driver id, the newest entry across all checks (checks are newest first). */
export function latestEntries(checks) {
  const out = {}
  for (const check of checks) {
    for (const e of check.entries) {
      if (!out[e.driverId]) out[e.driverId] = { ...e, checkDate: check.date, updatedBy: check.updatedBy }
    }
  }
  return out
}

export function screenshotIds(entry) {
  return [entry?.screenshotId, entry?.screenshot2Id].filter(Boolean)
}
