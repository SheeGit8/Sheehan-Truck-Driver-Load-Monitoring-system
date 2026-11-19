import { useState } from 'react'
import { CircleCheck, Hourglass, Send, TriangleAlert } from 'lucide-react'
import { api } from '../lib/api.js'
import { useToast } from '../lib/contexts.js'
import { formatDate, formatGb } from '../lib/format.js'
import { stampText, timeAgo } from '../lib/requests.js'
import { ShotThumbs } from './Screenshots.jsx'
import { Badge, Button, Dialog, Field, Input, Textarea } from './ui.jsx'

// Shared with the load check form, so the name only has to be typed once per device.
const NAME_KEY = 'slm-updated-by'

function readName() {
  try {
    return localStorage.getItem(NAME_KEY) || ''
  } catch {
    return ''
  }
}

/** Badge for a sent / finished request, or the "Request load" button when the phone needs it. */
export function RequestStatus({ request, needsLoad, onRequest }) {
  if (request?.status === 'Requested') {
    return (
      <Badge variant="warning" title={`Sent to the HR group on Telegram by ${request.requestedBy}, ${stampText(request.requestedAt)}. Waiting for "Done loading".`}>
        <Hourglass aria-hidden="true" /> Requested · {timeAgo(request.requestedAt)}
      </Badge>
    )
  }
  if (request?.status === 'Done') {
    return (
      <Badge variant="success" title={`${request.doneBy || 'HR'} pressed "Done loading" on ${stampText(request.doneAt)} (${timeAgo(request.doneAt)}). Record a new load check to confirm the data.`}>
        <CircleCheck aria-hidden="true" /> Loaded · {String(request.doneBy || 'HR').split(' ')[0]}
      </Badge>
    )
  }
  if (!needsLoad) return null
  return (
    <Button variant="outline" size="sm" className="w-fit" onClick={onRequest}>
      <Send aria-hidden="true" /> Request load
    </Button>
  )
}

/**
 * Confirms and sends a load request to the HR group.
 * target: { driver, entry } or null. telegram: false when Code.gs says Telegram isn't set up.
 */
export function RequestLoadDialog({ target, telegram, onClose, onSent }) {
  const [name, setName] = useState(readName)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const toast = useToast()

  const driver = target?.driver
  const entry = target?.entry
  const notSetUp = telegram === false

  const close = () => {
    setNote('')
    setError(null)
    onClose()
  }

  const send = async (e) => {
    e?.preventDefault()
    if (!name.trim()) {
      setError({ name: 'Enter your name so HR knows who asked.' })
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
      const res = await api.requestLoad({ driverId: driver.id, requestedBy: name.trim(), note: note.trim() })
      toast(`Load request for ${driver.label} sent to HR on Telegram${res?.photo ? ' with the screenshot' : ''}.`)
      setNote('')
      onSent?.()
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
      onClose={close}
      busy={busy}
      title={driver ? `Request load for ${driver.label}` : 'Request load'}
      description="Sends this phone’s latest reading and screenshot to the HR group on Telegram. HR presses “Done loading” there once it’s loaded."
      footer={
        <>
          <Button variant="outline" onClick={close} disabled={busy}>Cancel</Button>
          <Button onClick={send} loading={busy} disabled={notSetUp}>
            {!busy && <Send aria-hidden="true" />} Send to HR
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

          {entry && (entry.screenshotId || entry.screenshot2Id) ? (
            <div className="grid gap-1.5">
              <p className="text-sm font-medium">Screenshot sent to HR</p>
              <ShotThumbs size="lg" entry={{ ...entry, screenshot2Id: entry.screenshotId ? '' : entry.screenshot2Id }} title={driver.label} subtitle={driver.user} />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">This phone has no screenshot on its last check, so HR gets the details as text.</p>
          )}

          <Field id="request-name" label="Your name" required error={error?.name} hint="Shown to HR. Remembered on this device.">
            {(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={60} />}
          </Field>
          <Field id="request-note" label="Note for HR" hint="Optional, e.g. which promo to load.">
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
