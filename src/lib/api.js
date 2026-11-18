import { mockApi } from './mock.js'

/**
 * How the app reaches apps-script/Code.gs, in order of preference:
 *  1. google.script.run, when the page is served by the Apps Script web app itself.
 *  2. The Vercel function (VITE_REMOTE_API, e.g. /api/gas), which adds the sync token on the
 *     server. The browser only sends the app password people type in.
 *  3. Demo data kept in this browser (npm run dev).
 */
const gas = typeof window !== 'undefined' ? window.google?.script?.run : undefined
const remote = !gas && import.meta.env.VITE_REMOTE_API ? import.meta.env.VITE_REMOTE_API : ''

export const isDemo = !gas && !remote
export const needsPassword = !!remote

function gasCall(name, ...args) {
  return new Promise((resolve, reject) => {
    const runner = gas
      .withSuccessHandler(resolve)
      .withFailureHandler((err) => reject(new Error(err?.message || String(err))))
    runner[name](...args)
  })
}

/* App password for the Vercel version, remembered on this device. */
const PASSWORD_KEY = 'slm-app-password'
let password = ''
try {
  password = localStorage.getItem(PASSWORD_KEY) || ''
} catch {
  /* storage blocked: ask each visit */
}
export const hasPassword = () => !!password
export function setPassword(value) {
  password = value
  try {
    if (value) localStorage.setItem(PASSWORD_KEY, value)
    else localStorage.removeItem(PASSWORD_KEY)
  } catch {
    /* ignore */
  }
}

async function remoteCall(fn, ...args) {
  if (!password) {
    const e = new Error('Enter the app password.')
    e.auth = true
    throw e
  }
  let res
  try {
    res = await fetch(remote, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-App-Password': password },
      body: JSON.stringify({ fn, args }),
    })
  } catch {
    throw new Error('Can’t reach the server. Check your internet connection.')
  }
  const data = await res.json().catch(() => null)
  if (res.status === 401) {
    const e = new Error(data?.error || 'Wrong password.')
    e.auth = true
    throw e
  }
  if (!data?.ok) throw new Error(data?.error || `The server answered ${res.status}.`)
  return data.result
}

const backend = (call) => ({
  getAppData: () => call('getAppData'),
  getDataVersion: () => call('getDataVersion'),
  // baseVersion: the check's / driver's `version` from getAppData. null skips the conflict check.
  saveCheck: (check, baseVersion = null) => call('saveCheck', check, baseVersion),
  deleteCheck: (date, baseVersion = null) => call('deleteCheck', date, baseVersion),
  saveDriver: (driver, baseVersion = null) => call('saveDriver', driver, baseVersion),
  importData: (payload) =>
    call('importData', payload).catch((err) => {
      // Vercel is updated but Apps Script still runs the Code.gs from before Import existed.
      if (/importData|is not a function/i.test(err?.message || '')) {
        throw new Error('The sheet’s Code.gs is older than this app. Paste the latest Code.gs into Apps Script and deploy a new version (Deploy → Manage deployments → Edit → New version), then try again.')
      }
      throw err
    }),
  uploadScreenshot: (payload) => call('uploadScreenshot', payload),
  getScreenshot: (fileId) => call('getScreenshot', fileId),
  getScreenshotThumb: (fileId) => call('getScreenshotThumb', fileId),
  removeScreenshot: (fileId) => call('removeScreenshot', fileId),
})

/**
 * The backend refuses a save whose version is out of date with a message starting "CONFLICT:".
 * Such errors get `conflict = true` and the prefix removed, so screens can offer a reload.
 */
function withConflicts(backend) {
  const out = {}
  for (const [name, fn] of Object.entries(backend)) {
    out[name] = (...args) =>
      fn(...args).catch((err) => {
        const m = /CONFLICT:\s*([\s\S]*)$/.exec(err?.message || '')
        if (!m) throw err
        const e = new Error(m[1])
        e.conflict = true
        throw e
      })
  }
  return out
}

export const api = withConflicts(gas ? backend(gasCall) : remote ? backend(remoteCall) : mockApi)

/** How often an open page asks the sheet whether anything changed. */
export const SYNC_POLL_MS = 45_000

/* Screenshots are fetched once and kept for the session. */
const shotCache = new Map()
const thumbCache = new Map()

// At most this many downloads at once, so a long list of thumbnails doesn't swamp Apps Script.
const MAX_PARALLEL = 4
let running = 0
const waiting = []
function limited(task) {
  return new Promise((resolve, reject) => {
    const run = () => {
      running++
      task()
        .then(resolve, reject)
        .finally(() => {
          running--
          waiting.shift()?.()
        })
    }
    if (running < MAX_PARALLEL) run()
    else waiting.push(run)
  })
}

export function loadScreenshot(fileId) {
  if (!shotCache.has(fileId)) {
    const p = limited(() => api.getScreenshot(fileId)).catch((err) => {
      shotCache.delete(fileId)
      throw err
    })
    shotCache.set(fileId, p)
  }
  return shotCache.get(fileId)
}

/**
 * Small preview for lists. Uses the full screenshot when it's already loaded, when Drive has no
 * thumbnail yet, or when the sheet's Code.gs is older than getScreenshotThumb.
 */
export function loadThumb(fileId) {
  if (shotCache.has(fileId)) return shotCache.get(fileId)
  if (!thumbCache.has(fileId)) {
    const p = limited(() => api.getScreenshotThumb(fileId))
      .catch(() => null)
      .then((url) => url || loadScreenshot(fileId))
      .catch((err) => {
        thumbCache.delete(fileId)
        throw err
      })
    thumbCache.set(fileId, p)
  }
  return thumbCache.get(fileId)
}

export function cacheScreenshot(fileId, dataUrl) {
  shotCache.set(fileId, Promise.resolve(dataUrl))
}

export function driveLink(fileId) {
  return isDemo ? null : `https://drive.google.com/file/d/${fileId}/view`
}
