import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, CalendarPlus, CircleAlert, CircleCheck, Info, RefreshCw, Save } from 'lucide-react'
import { PageHeader } from '../components/Layout.jsx'
import { ScreenshotSlot } from '../components/Screenshots.jsx'
import { cn } from '../lib/cn.js'
import { useToast } from '../lib/contexts.js'
import { Badge, Button, Card, Dialog, Field, Input } from '../components/ui.jsx'
import { api, cacheScreenshot } from '../lib/api.js'
import {
  DEFAULT_LOAD, LOW_DATA_GB, PROMO_DAYS, addDays, entryStatus, formatDate, nowTime12, parseGb, to12h, to24h, todayIso,
} from '../lib/format.js'

const UPDATED_BY_KEY = 'slm-updated-by'

function readUpdatedBy() {
  try {
    return localStorage.getItem(UPDATED_BY_KEY) || ''
  } catch {
    return ''
  }
}

const shotFromId = (id) => (id ? { fileId: id } : null)

function blankRow(prevLoad = '') {
  return { currentData: '', load: prevLoad, expDate: '', expTime: '', remarks: '', shots: [null, null] }
}

/** A row counts as filled once any real reading is entered (a pre-filled load alone doesn't count). */
function isFilled(r) {
  return !!(String(r.currentData).trim() || r.expDate || r.expTime || r.remarks.trim() || r.shots[0] || r.shots[1])
}

export function CheckEditor({ data, editDate, stale, onDone, onCancel, onEditCheck }) {
  const { drivers, checks } = data
  const toast = useToast()
  const existing = editDate ? checks.find((c) => c.date === editDate) : null

  const [date, setDate] = useState(editDate || todayIso())
  const [updatedBy, setUpdatedBy] = useState(existing?.updatedBy || readUpdatedBy())
  const [dirty, setDirty] = useState(false)
  const [errors, setErrors] = useState({})
  const [progress, setProgress] = useState(null) // { label }
  const [confirmLeave, setConfirmLeave] = useState(false)
  const [conflict, setConflict] = useState(null) // message when someone else saved this check first
  // Version of this check when the editor opened ('' = new). The save is refused if it changed since.
  const [baseVersion] = useState(() => existing?.version ?? '')

  // Phones shown: everyone in load checks, plus anyone already in this check.
  const rowDrivers = useMemo(() => {
    const ids = new Set(existing?.entries.map((e) => e.driverId) || [])
    return drivers.filter((d) => d.active || ids.has(d.id))
  }, [drivers, existing])

  const [rows, setRows] = useState(() => {
    const prev = checks.find((c) => c.date < (editDate || todayIso()))
    const out = {}
    for (const d of rowDrivers) {
      const e = existing?.entries.find((x) => x.driverId === d.id)
      if (e) {
        out[d.id] = {
          currentData: String(e.currentData ?? ''),
          load: e.load || '',
          expDate: e.expDate || '',
          expTime: e.expTime || '',
          remarks: e.remarks || '',
          shots: [shotFromId(e.screenshotId), shotFromId(e.screenshot2Id)],
        }
      } else {
        out[d.id] = blankRow(prev?.entries.find((x) => x.driverId === d.id)?.load || '')
      }
    }
    return out
  })

  const [originalIds] = useState(() => new Set(existing?.entries.flatMap((e) => [e.screenshotId, e.screenshot2Id]).filter(Boolean) || []))

  const loadOptions = useMemo(() => {
    const set = new Set([DEFAULT_LOAD])
    checks.forEach((c) => c.entries.forEach((e) => e.load && set.add(e.load)))
    return [...set]
  }, [checks])

  const dateTaken = !existing && checks.some((c) => c.date === date)
  const filledCount = rowDrivers.filter((d) => isFilled(rows[d.id])).length
  const saving = !!progress

  useEffect(() => {
    if (!dirty) return
    const warn = (e) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const update = (driverId, patch) => {
    setDirty(true)
    setRows((r) => ({ ...r, [driverId]: { ...r[driverId], ...patch } }))
  }
  const setShot = (driverId, idx, shot) => {
    setDirty(true)
    setRows((r) => {
      const shots = [...r[driverId].shots]
      shots[idx] = shot
      return { ...r, [driverId]: { ...r[driverId], shots } }
    })
  }

  const leave = () => (dirty ? setConfirmLeave(true) : onCancel())

  /**
   * Calls autoRequestLoads until every low phone of the check is sent. Code.gs sends what fits in
   * one call and says how many are left (and how long to wait when Telegram asks to slow down).
   */
  const autoRequest = async (checkDate, by, lowCount) => {
    const sent = []
    const failed = []
    let remaining = 0
    try {
      for (let round = 0; round < 8; round++) {
        setProgress({ label: `Requesting load for ${lowCount} phone${lowCount === 1 ? '' : 's'} under ${LOW_DATA_GB} GB…` })
        const res = await api.autoRequestLoads({ date: checkDate, updatedBy: by })
        if (res?.enabled === false) return
        sent.push(...(res?.sent || []))
        failed.push(...(res?.failed || []))
        remaining = res?.remaining || 0
        if (!remaining) break
        for (let s = Math.ceil(res?.retryAfter || 0); s > 0; s--) {
          setProgress({ label: `Telegram is busy · continuing in ${s}s…` })
          await new Promise((r) => setTimeout(r, 1000))
        }
      }
    } catch (err) {
      failed.push({ driverLabel: '', error: err.message })
    }
    const names = (list) => list.map((x) => x.driverLabel).filter(Boolean).join(', ')
    if (sent.length) {
      toast(`Under ${LOW_DATA_GB} GB, so load was requested on Telegram automatically: ${names(sent)}.`, { duration: 7000 })
    }
    if (failed.length || remaining) {
      const why = failed.map((f) => (f.driverLabel ? `${f.driverLabel}: ${f.error}` : f.error)).join(' ')
      const left = remaining ? ` ${remaining} phone${remaining === 1 ? ' was' : 's were'} not sent yet.` : ''
      toast(`Some automatic load requests were not sent. ${why}${left} Use “Request load” on Overview.`, { type: 'error', duration: 10000 })
    }
  }

  const save = async (force = false) => {
    setConflict(null)
    const errs = {}
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) errs.date = 'Pick the date of this check.'
    if (dateTaken) errs.date = 'A load check already exists for this date. Open it to edit instead.'
    if (!updatedBy.trim()) errs.updatedBy = 'Enter who is recording this check, e.g. GAB.'
    setErrors(errs)
    if (Object.keys(errs).length) {
      document.getElementById(errs.date ? 'check-date' : 'check-updated-by')?.focus()
      return
    }
    const toSave = rowDrivers.filter((d) => isFilled(rows[d.id]) || existing?.entries.some((e) => e.driverId === d.id))
    if (!toSave.length) {
      toast('Fill in at least one driver before saving.', { type: 'error' })
      return
    }

    try {
      localStorage.setItem(UPDATED_BY_KEY, updatedBy.trim())
    } catch {
      /* ignore */
    }

    // 1) Upload new screenshots. Each finished upload is written back to state right away,
    //    so if a later one fails, pressing Save again won't upload it twice.
    const working = structuredClone(rows)
    const pending = []
    toSave.forEach((d) => working[d.id].shots.forEach((s, i) => s?.dataUrl && pending.push({ d, i, s })))

    try {
      for (let n = 0; n < pending.length; n++) {
        const { d, i, s } = pending[n]
        setProgress({ label: `Uploading ${n + 1} of ${pending.length}…` })
        const { fileId } = await api.uploadScreenshot({ dataUrl: s.dataUrl, date, driverId: d.id, driverLabel: d.label, slot: i + 1 })
        cacheScreenshot(fileId, s.dataUrl)
        working[d.id].shots[i] = { fileId }
        setRows((r) => {
          const shots = [...r[d.id].shots]
          shots[i] = { fileId }
          return { ...r, [d.id]: { ...r[d.id], shots } }
        })
      }

      // 2) Save the rows.
      setProgress({ label: 'Saving…' })
      const entries = toSave.map((d) => {
        const r = working[d.id]
        return {
          driverId: d.id,
          currentData: String(r.currentData).trim(),
          load: r.load.trim(),
          expDate: r.expDate,
          expTime: r.expTime,
          remarks: r.remarks.trim(),
          screenshotId: r.shots[0]?.fileId || '',
          screenshot2Id: r.shots[1]?.fileId || '',
        }
      })
      await api.saveCheck({ date, updatedBy: updatedBy.trim(), entries }, force ? null : baseVersion)

      // 3) Trash screenshots that were replaced or removed (best effort).
      const kept = new Set(entries.flatMap((e) => [e.screenshotId, e.screenshot2Id]))
      originalIds.forEach((id) => !kept.has(id) && api.removeScreenshot(id).catch(() => {}))

      setDirty(false)
      toast(`Load check for ${formatDate(date)} saved · ${entries.length} phone${entries.length === 1 ? '' : 's'}.`)

      // 4) Phones under 5 GB: ask HR on Telegram to load them, same as pressing "Request load".
      //    The check is already saved, so a problem here only shows a message.
      const low = entries.filter((e) => {
        const gb = parseGb(e.currentData)
        return gb !== null && gb < LOW_DATA_GB
      })
      if (low.length && data.telegram !== false) await autoRequest(date, updatedBy.trim(), low.length)

      await onDone()
    } catch (err) {
      if (err.conflict) setConflict(`The ${formatDate(date)} check was changed by someone else after you opened it.`)
      else toast(`Not saved: ${err.message}`, { type: 'error', duration: 7000 })
    } finally {
      setProgress(null)
    }
  }

  return (
    <div className="grid grid-cols-1 gap-6 pb-24">
      <PageHeader
        title={existing ? `Edit load check` : 'New load check'}
        description={
          existing
            ? `${formatDate(date, { weekday: true })} · ${existing.entries.length} phones recorded`
            : 'Record each phone’s GOMO balance and attach 2 screenshots from the app.'
        }
      >
        <Button variant="link" size="sm" className="-ml-0 mb-1 h-auto w-fit px-0 text-muted-foreground" onClick={leave}>
          <ArrowLeft aria-hidden="true" /> Back
        </Button>
      </PageHeader>

      <Card className="grid gap-4 p-5 sm:grid-cols-[minmax(0,14rem)_minmax(0,14rem)_1fr] sm:items-start">
        <Field id="check-date" label="Check date" required error={errors.date} hint={existing ? 'The date of a saved check can’t be changed.' : undefined}>
          {(p) => (
            <Input
              {...p}
              type="date"
              value={date}
              disabled={!!existing || saving}
              onChange={(e) => {
                setDate(e.target.value)
                setDirty(true)
                setErrors((x) => ({ ...x, date: undefined }))
              }}
            />
          )}
        </Field>
        <Field id="check-updated-by" label="Updated by" required error={errors.updatedBy} hint="Your initials or name. Remembered on this device.">
          {(p) => (
            <Input
              {...p}
              value={updatedBy}
              autoComplete="name"
              placeholder="e.g. GAB"
              disabled={saving}
              onChange={(e) => {
                setUpdatedBy(e.target.value)
                setDirty(true)
              }}
              onBlur={() => setErrors((x) => ({ ...x, updatedBy: updatedBy.trim() ? undefined : x.updatedBy }))}
            />
          )}
        </Field>
        <div className="flex items-start gap-2.5 rounded-lg bg-muted/60 p-3 text-[13px] text-muted-foreground sm:mt-6">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p>
            Phones left blank are skipped. For screenshots, click a box and choose an image, drag one in, or
            focus it and press <kbd className="rounded border bg-background px-1 font-mono text-[11px]">Ctrl</kbd>+<kbd className="rounded border bg-background px-1 font-mono text-[11px]">V</kbd>.
          </p>
        </div>
        {stale && !conflict && (
          <div role="status" className="flex items-start gap-2.5 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900 sm:col-span-3 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-200">
            <RefreshCw className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>
              Someone changed the sheet since you opened this page. Keep going. If they changed this same
              check, you’ll be asked before anything is overwritten.
            </span>
          </div>
        )}
        {dateTaken && (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 sm:col-span-3 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            <CircleAlert className="size-4 shrink-0" aria-hidden="true" />
            <span className="flex-1">There is already a load check for {formatDate(date)}.</span>
            <Button variant="outline" size="sm" onClick={() => onEditCheck(date)}>Open that check</Button>
          </div>
        )}
      </Card>

      <datalist id="load-options">
        {loadOptions.map((l) => <option key={l} value={l} />)}
      </datalist>

      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">Phones</h2>
        <span className="text-sm text-muted-foreground tabular-nums">{filledCount} of {rowDrivers.length} filled</span>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {rowDrivers.map((d, i) => (
          <EntryRow
            key={d.id}
            index={i}
            driver={d}
            row={rows[d.id]}
            checkDate={date}
            disabled={saving}
            onChange={(patch) => update(d.id, patch)}
            onShot={(i, s) => setShot(d.id, i, s)}
          />
        ))}
      </div>

      {/* Sticky action bar */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/75">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <p className="hidden text-sm text-muted-foreground sm:block" aria-live="polite">
            {progress ? progress.label : dirty ? 'Unsaved changes' : 'No changes yet'}
          </p>
          <div className="flex flex-1 justify-end gap-2 sm:flex-none">
            <Button variant="outline" onClick={leave} disabled={saving}>Cancel</Button>
            <Button onClick={() => save()} loading={saving} className="min-w-36">
              {!saving && <Save aria-hidden="true" />}
              {progress ? progress.label : existing ? 'Save changes' : 'Save load check'}
            </Button>
          </div>
        </div>
      </div>

      <Dialog
        open={confirmLeave}
        onClose={() => setConfirmLeave(false)}
        title="Discard unsaved changes?"
        description="The numbers and screenshots you added to this check will be lost."
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirmLeave(false)}>Keep editing</Button>
            <Button variant="destructive" onClick={onCancel}>Discard</Button>
          </>
        }
      >
        <p className="text-sm text-muted-foreground">Screenshots are only uploaded when you save.</p>
      </Dialog>

      <Dialog
        open={!!conflict}
        onClose={() => setConflict(null)}
        busy={saving}
        title="Someone else saved this check first"
        description={conflict || ''}
        footer={
          <>
            <Button variant="outline" onClick={onDone} disabled={saving}>Discard mine, load theirs</Button>
            <Button variant="destructive" onClick={() => save(true)} loading={saving}>Save mine anyway</Button>
          </>
        }
      >
        <p className="text-sm text-muted-foreground">
          <strong className="font-medium text-foreground">Save mine anyway</strong> writes every phone on your screen over
          their version. <strong className="font-medium text-foreground">Discard</strong> takes you back to the list with their
          version loaded, so you can open it and redo your changes.
        </p>
      </Dialog>
    </div>
  )
}

function EntryRow({ index, driver, row, checkDate, disabled, onChange, onShot }) {
  const status = entryStatus({ currentData: row.currentData, expDate: row.expDate }, checkDate)
  const filled = isFilled(row)
  const promoEnd = addDays(checkDate, PROMO_DAYS)

  return (
    <Card className={cn('min-w-0 p-4 sm:p-5', filled && 'ring-1 ring-foreground/5')}>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_17rem]">
        <div className="grid content-start gap-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="flex min-w-0 items-center gap-3">
              <span
                className={cn(
                  'grid size-8 shrink-0 place-items-center rounded-full border text-xs font-semibold',
                  filled ? 'border-transparent bg-primary text-primary-foreground' : 'text-muted-foreground',
                )}
                aria-hidden="true"
              >
                {filled ? <CircleCheck className="size-4" /> : index + 1}
              </span>
              <div className="min-w-0">
                <h3 className="font-semibold tracking-tight">{driver.label}</h3>
                <p className="truncate text-xs text-muted-foreground">
                  {driver.user} · <span className="font-mono">{driver.sim || 'no SIM'}</span>
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {status.data === 'low' && <Badge variant="danger"><CircleAlert aria-hidden="true" />Under {LOW_DATA_GB} GB</Badge>}
              {status.expiry === 'expired' && <Badge variant="danger">Expired before check</Badge>}
              {status.expiry === 'soon' && <Badge variant="warning">Ends within 2 days</Badge>}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Field label="Current data (GB)">
              {(p) => (
                <Input
                  {...p}
                  inputMode="decimal"
                  placeholder="e.g. 38.13"
                  value={row.currentData}
                  disabled={disabled}
                  className="font-mono tabular-nums"
                  onChange={(e) => onChange({ currentData: e.target.value })}
                />
              )}
            </Field>
            <Field label="Availed load" className="col-span-2 sm:col-span-3">
              {(p) => (
                <Input
                  {...p}
                  list="load-options"
                  placeholder={DEFAULT_LOAD}
                  value={row.load}
                  disabled={disabled}
                  onChange={(e) => onChange({ load: e.target.value })}
                />
              )}
            </Field>
            <Field label="Exp. date">
              {(p) => (
                <Input {...p} type="date" value={row.expDate} disabled={disabled} onChange={(e) => onChange({ expDate: e.target.value })} />
              )}
            </Field>
            <Field label="Exp. time">
              {(p) => (
                <Input {...p} type="time" value={to24h(row.expTime)} disabled={disabled} onChange={(e) => onChange({ expTime: to12h(e.target.value) })} />
              )}
            </Field>
            <div className="col-span-2 flex items-end">
              <Button
                variant="outline"
                className="w-full sm:w-auto"
                disabled={disabled}
                title={`Sets expiry to ${formatDate(promoEnd)} at the current time`}
                onClick={() =>
                  onChange({
                    expDate: promoEnd,
                    expTime: row.expTime || nowTime12(),
                    load: row.load || DEFAULT_LOAD,
                  })
                }
              >
                <CalendarPlus aria-hidden="true" /> Loaded today · ends {formatDate(promoEnd, { withYear: false })}
              </Button>
            </div>
            <Field label="Remarks" className="col-span-2 sm:col-span-4">
              {(p) => (
                <Input {...p} placeholder="e.g. Not enough DATA" value={row.remarks} disabled={disabled} onChange={(e) => onChange({ remarks: e.target.value })} />
              )}
            </Field>
          </div>
        </div>

        <fieldset disabled={disabled} className="grid min-w-0 grid-cols-2 gap-3 self-start disabled:opacity-60">
          <legend className="sr-only">GOMO screenshots for {driver.label}</legend>
          {[0, 1].map((i) => (
            <ScreenshotSlot key={i} slot={i + 1} value={row.shots[i]} driverLabel={driver.label} onChange={(s) => onShot(i, s)} />
          ))}
        </fieldset>
      </div>
    </Card>
  )
}
