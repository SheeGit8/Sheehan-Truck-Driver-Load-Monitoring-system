import { useId, useRef, useState } from 'react'
import { ClipboardPaste, FileSpreadsheet, FileUp, Info, ShieldCheck, TriangleAlert } from 'lucide-react'
import { Badge, Button, Dialog, Textarea } from './ui.jsx'
import { api } from '../lib/api.js'
import { cn } from '../lib/cn.js'
import { useToast } from '../lib/contexts.js'
import { formatDate, formatGb } from '../lib/format.js'
import { importPayload, parseTable, readOldSheet } from '../lib/importSheet.js'

const MAX_FILE_BYTES = 5 * 1024 * 1024
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
// Compact table cells: the preview sits inside a dialog, so it can't use the roomy page tables.
const th = 'h-8 px-3 text-left align-middle text-xs font-medium whitespace-nowrap text-muted-foreground'
const td = 'px-3 py-2 align-middle'

/**
 * Brings the history from the old monitoring spreadsheet into the app.
 * Step 1: choose the .csv download or paste the copied cells. Step 2: check the preview, then import.
 * Nothing is written until "Import" is pressed, and nothing already in the app is changed.
 */
export function ImportDialog({ open, onClose, data, onImported }) {
  const [source, setSource] = useState(null) // { name, text }
  const [pasted, setPasted] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const fileRef = useRef(null)
  const pasteId = useId()
  const toast = useToast()

  // Re-read against the current data, so drivers or checks added meanwhile show as "already in the app".
  const result = source ? readOldSheet(parseTable(source.text), data) : null

  const reset = () => {
    setSource(null)
    setPasted('')
    setError('')
  }
  const close = () => {
    if (busy) return
    reset()
    onClose()
  }

  const readFile = async (file) => {
    setError('')
    if (!file) return
    if (/\.(xlsx|xls|ods)$/i.test(file.name)) {
      setError('That’s a spreadsheet file. In Google Sheets use File → Download → Comma-separated values (.csv). In Excel use File → Save As → CSV. Then choose the .csv here.')
      return
    }
    if (file.size > MAX_FILE_BYTES) {
      setError('That file is larger than 5 MB. Download only the monitoring tab as .csv.')
      return
    }
    try {
      setSource({ name: file.name, text: await file.text() })
    } catch {
      setError('Couldn’t read that file. Try downloading it again.')
    }
  }

  const readPasted = () => {
    setError('')
    if (!pasted.trim()) {
      setError('Paste the cells from the old sheet first.')
      return
    }
    setSource({ name: 'Pasted cells', text: pasted })
  }

  const newChecks = result ? result.checks.filter((c) => c.status === 'new') : []
  const oldChecks = result ? result.checks.length - newChecks.length : 0
  const newDrivers = result ? result.drivers.filter((d) => d.status === 'new') : []
  const newRows = newChecks.reduce((n, c) => n + c.entries.length, 0)
  const nothingNew = result?.ok && newChecks.length === 0 && newDrivers.length === 0

  const runImport = async () => {
    setBusy(true)
    setError('')
    try {
      const out = await api.importData(importPayload(result))
      const parts = [`${plural(out.checksAdded, 'load check')} (${plural(out.rowsAdded, 'row')})`]
      if (out.driversAdded) parts.push(plural(out.driversAdded, 'new driver'))
      let msg = `Imported ${parts.join(' and ')}.`
      if (out.checksSkipped?.length) msg += ` ${plural(out.checksSkipped.length, 'date')} already in the app ${out.checksSkipped.length === 1 ? 'was' : 'were'} skipped.`
      toast(msg, { duration: 6000 })
      reset()
      onClose()
      await onImported()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const footer = result ? (
    <>
      <Button variant="outline" onClick={() => setSource(null)} disabled={busy}>Choose another file</Button>
      <Button onClick={runImport} loading={busy} disabled={!result.ok || nothingNew}>
        {newChecks.length ? `Import ${plural(newChecks.length, 'load check')}` : newDrivers.length ? `Import ${plural(newDrivers.length, 'driver')}` : 'Import'}
      </Button>
    </>
  ) : (
    <Button variant="outline" onClick={close}>Cancel</Button>
  )

  return (
    <Dialog
      open={open}
      onClose={close}
      busy={busy}
      className="max-w-2xl"
      title="Import from the old spreadsheet"
      description={result ? `Check what will be added from “${source.name}”.` : 'Bring the drivers and past load checks from the old monitoring sheet into the app.'}
      footer={footer}
    >
      {!result ? (
        <div className="grid gap-4">
          <div
            onDragOver={(e) => {
              e.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragging(false)
              readFile(e.dataTransfer.files?.[0])
            }}
            className={cn('grid justify-items-center gap-3 rounded-lg border border-dashed px-4 py-6 text-center transition-colors', dragging && 'border-primary bg-accent/60')}
          >
            <span className="grid size-10 place-items-center rounded-lg border bg-card text-muted-foreground" aria-hidden="true">
              <FileUp className="size-5" />
            </span>
            <div className="grid gap-1">
              <p className="text-sm font-medium">Upload the sheet as a .csv file</p>
              <p className="text-xs text-muted-foreground">
                In the old sheet: <span className="font-medium text-foreground">File → Download → Comma-separated values (.csv)</span>
              </p>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain"
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(e) => {
                readFile(e.target.files?.[0])
                e.target.value = ''
              }}
            />
            <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
              <FileSpreadsheet aria-hidden="true" /> Choose .csv file
            </Button>
          </div>

          <div className="flex items-center gap-3 text-xs text-muted-foreground" aria-hidden="true">
            <span className="h-px flex-1 bg-border" /> or <span className="h-px flex-1 bg-border" />
          </div>

          <div className="grid gap-2">
            <label htmlFor={pasteId} className="text-[13px] font-medium">Paste the cells</label>
            <p className="text-xs text-muted-foreground">
              In the old sheet, click the empty box left of column A to select everything, press <kbd className="rounded border px-1 font-mono">Ctrl</kbd>+<kbd className="rounded border px-1 font-mono">C</kbd>, then paste here.
            </p>
            <Textarea
              id={pasteId}
              rows={4}
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              placeholder="Name:	USER	Surname:	Driver Emails:	…"
              className="font-mono text-xs"
            />
            <Button variant="secondary" size="sm" className="justify-self-start" onClick={readPasted} disabled={!pasted.trim()}>
              <ClipboardPaste aria-hidden="true" /> Read pasted cells
            </Button>
          </div>

          <Note icon={ShieldCheck}>
            Passwords, Messenger passwords and GOMO app PINs are skipped. Nothing is saved until you press Import, and nothing already in the app is changed.
          </Note>
          {error && <ErrorNote>{error}</ErrorNote>}
        </div>
      ) : (
        <div className="grid gap-4">
          {!result.ok ? (
            <ErrorNote>
              No drivers found in “{source.name}”. Make sure it’s the monitoring tab with the header row (Name, USER, Current Data, Availed Load, Exp. Date…).
            </ErrorNote>
          ) : (
            <>
              <dl className="grid grid-cols-3 gap-2 sm:gap-3">
                <Stat label="Load checks" value={newChecks.length} hint={oldChecks ? `${oldChecks} already in app` : 'all new'} />
                <Stat label="Phone rows" value={newRows} hint="to add" />
                <Stat label="Drivers" value={newDrivers.length} hint={result.drivers.length - newDrivers.length ? `new · ${result.drivers.length - newDrivers.length} already in app` : 'new'} />
              </dl>

              {nothingNew && <Note icon={Info}>Everything in this file is already in the app.</Note>}
              {oldChecks > 0 && !nothingNew && (
                <Note icon={Info}>Dates that already have a load check in the app are skipped, so nothing is overwritten.</Note>
              )}

              {result.warnings.length > 0 && <Warnings items={result.warnings} />}

              {result.checks.length > 0 && (
                <section className="grid gap-2" aria-label="Load checks in the file">
                  <h3 className="text-[13px] font-medium">Load checks</h3>
                  <div className="max-h-60 overflow-y-auto rounded-lg border">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-muted">
                        <tr className="border-b">
                          <th className={th}>Date</th>
                          <th className={cn(th, 'hidden sm:table-cell')}>Updated by</th>
                          <th className={th}>Phones</th>
                          <th className={cn(th, 'hidden sm:table-cell')}>Lowest data</th>
                          <th className={th}><span className="sr-only">Status</span></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {result.checks.map((c) => (
                          <tr key={c.date} className={cn(c.status === 'existing' && 'text-muted-foreground')}>
                            <td className={cn(td, 'font-medium whitespace-nowrap')}>{formatDate(c.date)}</td>
                            <td className={cn(td, 'hidden sm:table-cell')}>{c.updatedBy || '—'}</td>
                            <td className={cn(td, 'tabular-nums')}>{c.entries.length}</td>
                            <td className={cn(td, 'hidden tabular-nums whitespace-nowrap sm:table-cell')}>{lowest(c.entries)}</td>
                            <td className={cn(td, 'text-right')}>
                              {c.status === 'new' ? <Badge variant="success">New</Badge> : <Badge variant="muted">Already in app</Badge>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}

              <section className="grid gap-2" aria-label="Drivers in the file">
                <h3 className="text-[13px] font-medium">Drivers &amp; phones</h3>
                <div className="max-h-60 overflow-y-auto rounded-lg border">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-muted">
                      <tr className="border-b">
                        <th className={th}>Account</th>
                        <th className={th}>Assigned driver</th>
                        <th className={cn(th, 'hidden sm:table-cell')}>GOMO SIM</th>
                        <th className={th}><span className="sr-only">Status</span></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {result.drivers.map((d) => (
                        <tr key={d.key} className={cn(d.status === 'existing' && 'text-muted-foreground')}>
                          <td className={cn(td, 'font-medium whitespace-nowrap')}>{d.label}</td>
                          <td className={cn(td, 'max-w-0 w-full truncate')} title={d.user}>{d.user}</td>
                          <td className={cn(td, 'hidden tabular-nums whitespace-nowrap sm:table-cell')}>{d.sim || '—'}</td>
                          <td className={cn(td, 'text-right')}>
                            {d.status === 'new' ? <Badge variant="success">New</Badge> : <Badge variant="muted">Already in app</Badge>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              {result.ignoredSecrets && (
                <Note icon={ShieldCheck}>Password, Messenger password and GOMO app PIN columns were found and skipped.</Note>
              )}
            </>
          )}
          {error && <ErrorNote>{error}</ErrorNote>}
        </div>
      )}
    </Dialog>
  )
}

function lowest(entries) {
  const nums = entries.map((e) => parseFloat(e.currentData)).filter((n) => Number.isFinite(n))
  return nums.length ? formatGb(String(Math.min(...nums))) : '—'
}

function Stat({ label, value, hint }) {
  return (
    <div className="rounded-lg border bg-card px-3 py-2.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-xl font-semibold tracking-tight tabular-nums">{value}</dd>
      <dd className="truncate text-xs text-muted-foreground">{hint}</dd>
    </div>
  )
}

function Note({ icon: Icon, children }) {
  return (
    <p className="flex items-start gap-2 rounded-lg border bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground">
      <Icon className="mt-px size-3.5 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </p>
  )
}

function ErrorNote({ children }) {
  return (
    <p role="alert" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300">
      <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </p>
  )
}

function Warnings({ items }) {
  const shown = items.slice(0, 5)
  return (
    <div className="grid gap-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-300">
      <p className="flex items-center gap-2 font-medium">
        <TriangleAlert className="size-3.5" aria-hidden="true" /> {plural(items.length, 'row')} need a look
      </p>
      <ul className="grid list-disc gap-0.5 pl-9">
        {shown.map((w, i) => <li key={i}>{w}</li>)}
      </ul>
      {items.length > shown.length && <p className="pl-5">…and {items.length - shown.length} more.</p>}
    </div>
  )
}
