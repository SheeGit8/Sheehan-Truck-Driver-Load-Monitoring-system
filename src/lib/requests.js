/** Helpers for load requests ("Request load" -> Telegram HR group -> "Done loading"). */
import { formatDate } from './format.js'

/** '2026-11-19 14:05' (sheet time) -> Date */
function parseStamp(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})/.exec(String(s || ''))
  return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) : null
}

export function timeAgo(stamp, now = Date.now()) {
  const d = parseStamp(stamp)
  if (!d) return ''
  const min = Math.max(0, Math.round((now - d.getTime()) / 60000))
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const h = Math.round(min / 60)
  if (h < 24) return `${h}h ago`
  const days = Math.round(h / 24)
  return `${days}d ago`
}

export function stampText(stamp) {
  const d = parseStamp(stamp)
  if (!d) return stamp || ''
  return `${formatDate(stamp.slice(0, 10), { withYear: false })}, ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`
}

/** For each driver id, the newest load request (requests come newest first). */
export function latestRequests(requests = []) {
  const out = {}
  for (const r of requests) if (r.driverId && !out[r.driverId]) out[r.driverId] = r
  return out
}

/**
 * The request worth showing next to a phone: an open one, or a finished one until a newer
 * load check has been recorded (then the phone's own reading speaks for itself).
 */
export function currentRequest(request, entry) {
  if (!request) return null
  if (request.status !== 'Done') return request
  const doneDay = String(request.doneAt || request.requestedAt).slice(0, 10)
  return !entry || doneDay >= entry.checkDate ? request : null
}
