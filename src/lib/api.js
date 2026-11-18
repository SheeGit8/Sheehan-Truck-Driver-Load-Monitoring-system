import { mockApi } from './mock.js'

/**
 * Talks to apps-script/Code.gs through google.script.run when the page is served by the
 * Apps Script web app. Anywhere else (npm run dev) it uses demo data kept in this browser.
 */
const gas = typeof window !== 'undefined' ? window.google?.script?.run : undefined

export const isDemo = !gas

function call(name, ...args) {
  return new Promise((resolve, reject) => {
    const runner = gas
      .withSuccessHandler(resolve)
      .withFailureHandler((err) => reject(new Error(err?.message || String(err))))
    runner[name](...args)
  })
}

const gasApi = {
  getAppData: () => call('getAppData'),
  saveCheck: (check) => call('saveCheck', check),
  deleteCheck: (date) => call('deleteCheck', date),
  saveDriver: (driver) => call('saveDriver', driver),
  uploadScreenshot: (payload) => call('uploadScreenshot', payload),
  getScreenshot: (fileId) => call('getScreenshot', fileId),
  removeScreenshot: (fileId) => call('removeScreenshot', fileId),
}

export const api = gas ? gasApi : mockApi

/* Screenshots are fetched once and kept for the session. */
const shotCache = new Map()

export function loadScreenshot(fileId) {
  if (!shotCache.has(fileId)) {
    const p = api.getScreenshot(fileId).catch((err) => {
      shotCache.delete(fileId)
      throw err
    })
    shotCache.set(fileId, p)
  }
  return shotCache.get(fileId)
}

export function cacheScreenshot(fileId, dataUrl) {
  shotCache.set(fileId, Promise.resolve(dataUrl))
}

export function driveLink(fileId) {
  return isDemo ? null : `https://drive.google.com/file/d/${fileId}/view`
}
