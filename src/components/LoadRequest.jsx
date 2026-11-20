import { useId, useState } from 'react'
import { CircleCheck, Hourglass, Send, TriangleAlert } from 'lucide-react'
import { api } from '../lib/api.js'
import { useToast } from '../lib/contexts.js'
import { formatDate, formatGb } from '../lib/format.js'
import { stampText, timeAgo } from '../lib/requests.js'
import { ShotThumbs } from './Screenshots.jsx'
import { Badge, Button, Dialog, Field, Input, Switch, Textarea } from './ui.jsx'

// Shared with the load check form, so the name only has to be typed once per device.
const NAME_KEY = 'slm-updated-by'

function readName() {
  try {
    return localStorage.getItem(NAME_KEY) || ''
  } catch {
    return ''
  }
}

/**
 * The phone's request badge (Requested / Loaded) and its Telegram buttons:
 * "Request load" on every phone whatever its data (highlighted when it needs load), unless a
 * request is still waiting for "Done loading"; and "Send to Telegram" (the current data, for HR's
 * information only).
 * onSend(askLoad) opens the send dialog.
 */
export function RequestStatus({ request, needsLoad, onSend }) {
  const waiting = request?.status === 'Requested'
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {waiting && (
        <Badge variant="warning" title={`Sent to the HR group on Telegram by ${request.requestedBy}, ${stampText(request.requestedAt)}. Waiting for "Done loading".`}>
          <Hourglass aria-hidden="true" /> Requested · {timeAgo(request.requestedAt)}
        </Badge>
      )}
      {request?.status === 'Done' && (
        <Badge variant="success" title={`${request.doneBy || 'HR'} pressed "Done loading" on ${stampText(request.doneAt)} (${timeAgo(request.doneAt)}). Record a new load check to confirm the data.`}>
          <CircleCheck aria-hidden="true" /> Loaded · {String(request.doneBy || 'HR').split(' ')[0]}
        </Badge>
      )}
      {!waiting && (
        <Button
          variant="outline"
          size="sm"
          className={needsLoad ? undefined : 'h-7 px-2 text-muted-foreground'}
          title={needsLoad ? undefined : 'Ask HR to load this phone even though its data isn’t low.'}
          onClick={() => onSend(true)}
        >
          <Send aria-hidden="true" /> Request load
        </Button>
      )}
      <Button variant="ghost" size="sm" className="h-7 px-2 text-muted-foreground" onClick={() => onSend(false)}>
        <Send aria-hidden="true" /> Send to Telegram
      </Button>
    </div>
  )
}

/**
 * Sends one phone's latest data and both screenshots to the HR group.
 * target: { driver, entry, askLoad, openRequest } or null.
 *   askLoad: start with "Ask HR to load this phone" on (adds the "Done loading" button).
 *   openRequest: a request still waiting for "Done loading"; a second one can't be made.
 * telegram: false when Code.gs says Telegram isn't set up.
 * Mount with a new `key` per target so the form starts fresh.
 */
export function RequestLoadDialog({ target, telegram, onClose, onSent }) {
  const [name, setName] = useState(readName)
  const [note, setNote] = useState('')
  const [askLoad, setAskLoad] = useState(!!target?.askLoad && !target?.openRequest)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const switchId = useId()
  const toast = useToast()

  const driver = target?.driver
  const entry = target?.entry
  const openRequest = target?.openRequest
  const notSetUp = telegram === false
  const shots = entry ? [entry.screenshotId, entry.screenshot2Id].filter(Boolean).length : 0

  const send = async (e) => {
    e?.preventDefault()
    if (!name.trim()) {
      setError({ name: 'Enter your name so HR knows who sent it.' })
      return
    }
    setBusy(true)
    setError(null)
    try {
      localStorage.setItem(NAME_KEY, name.trim())
    } catch {
      /* ignore */
    }
    try {
      const res = await api.requestLoad({ driverId: driver.id, requestedBy: name.trim(), note: note.trim(), askLoad })
      const photos = res?.photos ?? (res?.photo ? 1 : 0)
      const withShots = photos ? ` with ${photos === 1 ? 'the screenshot' : `${photos} screenshots`}` : ''
      toast(askLoad ? `Load request for ${driver.label} sent to HR on Telegram${withShots}.` : `${driver.label}’s current data sent to Telegram${withShots}.`)
      if (askLoad) onSent?.()
      onClose()
    } catch (err) {
      setError({ form: err.message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={!!target}
      onClose={onClose}
      busy={busy}
      title={driver ? (askLoad ? `Request load for ${driver.label}` : `Send ${driver.label} to Telegram`) : 'Send to Telegram'}
      description={askLoad
        ? 'Sends this phone’s latest reading and screenshots to the HR group, with a “Done loading” button HR presses once it’s loaded.'
        : 'Sends this phone’s latest reading and screenshots to the HR group, for their information.'}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={send} loading={busy} disabled={notSetUp}>
            {!busy && <Send aria-hidden="true" />} {askLoad ? 'Send load request' : 'Send to Telegram'}
          </Button>
        </>
      }
    >
      {driver && (
        <form onSubmit={send} className="grid gap-4">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-lg border bg-muted/40 p-3 text-sm">
            <dt className="text-muted-foreground">Driver</dt>
            <dd className="min-w-0 truncate">{driver.user || '—'}</dd>
            <dt className="text-muted-foreground">GOMO SIM</dt>
            <dd className="font-mono tabular-nums">{driver.sim || '—'}</dd>
            <dt className="text-muted-foreground">Data left</dt>
            <dd>
              {entry ? (
                <>
                  <span className="font-medium">{formatGb(entry.currentData)}</span>
                  <span className="text-muted-foreground"> · checked {formatDate(entry.checkDate, { withYear: false })}</span>
                </>
              ) : (
                <span className="text-muted-foreground">No load check yet</span>
              )}
            </dd>
            {entry?.load && (
              <>
                <dt className="text-muted-foreground">Load</dt>
                <dd className="min-w-0">{entry.load}{entry.expDate && <span className="text-muted-foreground"> · ends {formatDate(entry.expDate, { withYear: false })}</span>}</dd>
              </>
            )}
          </dl>

          {shots ? (
            <div className="grid gap-1.5">
              <p className="text-sm font-medium">{shots === 1 ? 'Screenshot sent to Telegram' : 'Both screenshots are sent to Telegram'}</p>
              <ShotThumbs size="lg" entry={entry} title={driver.label} subtitle={driver.user} />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">This phone has no screenshots on its last check, so the details go as text.</p>
          )}

          <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
            <div className="grid gap-0.5">
              <label htmlFor={switchId} className="text-sm font-medium">Ask HR to load this phone</label>
              <p className="text-xs text-muted-foreground">
                {openRequest
                  ? `Already requested ${timeAgo(openRequest.requestedAt)} by ${openRequest.requestedBy}. Waiting for “Done loading”.`
                  : 'Adds a “Done loading” button. The phone shows “Requested” until HR presses it.'}
              </p>
            </div>
            <Switch id={switchId} checked={askLoad} onCheckedChange={setAskLoad} disabled={!!openRequest} className="mt-0.5 disabled:opacity-50" />
          </div>

          <Field id="request-name" label="Your name" required error={error?.name} hint="Shown to HR. Remembered on this device.">
            {(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={60} />}
          </Field>
          <Field id="request-note" label="Note for HR" hint={askLoad ? 'Optional, e.g. which promo to load.' : 'Optional.'}>
            {(p) => <Textarea {...p} value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={300} />}
          </Field>

          {notSetUp && (
            <p role="alert" className="flex gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              Telegram isn’t set up yet. Fill in TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in Code.gs (see the README).
            </p>
          )}
          {error?.form && (
            <p role="alert" className="flex gap-2 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              {error.form}
            </p>
          )}
          <button type="submit" hidden />
        </form>
      )}
    </Dialog>
  )
}
