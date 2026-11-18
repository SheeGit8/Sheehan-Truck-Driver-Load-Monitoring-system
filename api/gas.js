/**
 * Vercel serverless function: the only path from the hosted app to the Google Sheet.
 *
 * Browser --(APP_PASSWORD)--> /api/gas --(SYNC_TOKEN)--> Apps Script doPost --> Sheet / Drive
 *
 * GAS_URL and SYNC_TOKEN stay on the server (Vercel environment variables); the browser never
 * sees them. The browser only needs APP_PASSWORD, which people type into the app once.
 */
import { createHash, timingSafeEqual } from 'node:crypto'

const ALLOWED = new Set([
  'getAppData', 'getDataVersion', 'saveCheck', 'deleteCheck', 'saveDriver', 'importData',
  'uploadScreenshot', 'getScreenshot', 'getScreenshotThumb', 'removeScreenshot',
])

const digest = (s) => createHash('sha256').update(String(s)).digest()
const samePassword = (given, expected) => timingSafeEqual(digest(given), digest(expected))

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Use POST.' })

  const { GAS_URL, SYNC_TOKEN, APP_PASSWORD } = process.env
  if (!GAS_URL || !SYNC_TOKEN || !APP_PASSWORD) {
    return res.status(500).json({ ok: false, error: 'The server is not set up yet: add GAS_URL, SYNC_TOKEN and APP_PASSWORD in Vercel, then redeploy.' })
  }
  if (!samePassword(req.headers['x-app-password'] || '', APP_PASSWORD)) {
    return res.status(401).json({ ok: false, error: 'Wrong password.' })
  }

  const { fn, args = [] } = req.body || {}
  if (!ALLOWED.has(fn) || !Array.isArray(args)) {
    return res.status(400).json({ ok: false, error: 'Unknown request.' })
  }

  let data
  try {
    // Apps Script answers POST with a redirect to the result; fetch follows it.
    const r = await fetch(GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ token: SYNC_TOKEN, fn, args }),
      redirect: 'follow',
    })
    data = JSON.parse(await r.text())
  } catch {
    return res.status(502).json({
      ok: false,
      error: 'Google Sheets did not answer. Check GAS_URL ends in /exec and the deployment is shared with "Anyone".',
    })
  }

  if (data.ok) return res.status(200).json(data)
  // A wrong sync token is a server setup problem, not the user's password.
  if (data.status === 401) {
    return res.status(502).json({ ok: false, error: 'SYNC_TOKEN in Vercel does not match the sheet. Run generateSyncToken again and update Vercel.' })
  }
  return res.status(data.status === 503 ? 503 : 400).json({ ok: false, error: data.error })
}
