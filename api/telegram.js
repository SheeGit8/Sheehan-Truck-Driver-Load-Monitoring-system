/**
 * Vercel serverless function: Telegram's webhook for the load-request bot.
 *
 * Telegram --(secret header)--> /api/telegram --(SYNC_TOKEN)--> Apps Script telegramUpdate
 *
 * Telegram calls this when someone presses "Done loading" or sends /chatid in the HR group.
 * Apps Script can't take the webhook itself (it can't read the secret header, and it answers POST
 * with a redirect that Telegram treats as a failure), so this function checks the secret and passes
 * the update on. connectTelegram in Code.gs registers this URL with the same secret.
 */
import { createHash, timingSafeEqual } from 'node:crypto'

const digest = (s) => createHash('sha256').update(String(s)).digest()

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false })

  const { GAS_URL, SYNC_TOKEN } = process.env
  if (!GAS_URL || !SYNC_TOKEN) return res.status(500).json({ ok: false, error: 'GAS_URL and SYNC_TOKEN are not set in Vercel.' })

  // Same value as telegramSecret_() in Code.gs.
  const expected = createHash('sha256').update(`telegram-webhook:${SYNC_TOKEN}`).digest('hex')
  const given = String(req.headers['x-telegram-bot-api-secret-token'] || '')
  if (!timingSafeEqual(digest(given), digest(expected))) return res.status(401).json({ ok: false })

  const update = req.body && typeof req.body === 'object' ? req.body : null
  if (update) {
    try {
      const r = await fetch(GAS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ token: SYNC_TOKEN, fn: 'telegramUpdate', args: [update] }),
        redirect: 'follow',
      })
      const data = JSON.parse(await r.text())
      if (!data.ok) console.error('telegramUpdate failed:', data.error)
    } catch (err) {
      console.error('Could not reach Apps Script:', err?.message || err)
    }
  }
  // Always 200 for a genuine Telegram call, so Telegram doesn't resend the same update over and over.
  return res.status(200).json({ ok: true })
}
