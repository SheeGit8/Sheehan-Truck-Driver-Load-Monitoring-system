import { useState } from 'react'
import { ChevronDown, ClipboardList, ClipboardPlus, Pencil, Trash2 } from 'lucide-react'
import { EmptyState, PageHeader, Table, td, th } from '../components/Layout.jsx'
import { ShotsButton } from '../components/Screenshots.jsx'
import { DataCell, ExpiryCell } from '../components/Status.jsx'
import { cn } from '../lib/cn.js'
import { useToast } from '../lib/contexts.js'
import { Badge, Button, Card, Dialog } from '../components/ui.jsx'
import { api } from '../lib/api.js'
import { entryStatus, formatDate, todayIso } from '../lib/format.js'

export function Checks({ data, onNewCheck, onEditCheck, onChanged }) {
  const { drivers, checks } = data
  const today = todayIso()
  const toast = useToast()
  const [open, setOpen] = useState(() => new Set(checks[0] ? [checks[0].date] : []))
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [deleteVersion, setDeleteVersion] = useState(null) // version of the check the user chose to delete
  const [deleting, setDeleting] = useState(false)

  const driverById = Object.fromEntries(drivers.map((d) => [d.id, d]))
  const order = (id) => driverById[id]?.sort ?? 999

  const toggle = (date) =>
    setOpen((s) => {
      const n = new Set(s)
      if (n.has(date)) n.delete(date)
      else n.add(date)
      return n
    })

  const doDelete = async () => {
    setDeleting(true)
    try {
      await api.deleteCheck(confirmDelete, deleteVersion)
      toast(`Load check for ${formatDate(confirmDelete)} deleted.`)
      setConfirmDelete(null)
      await onChanged()
    } catch (err) {
      toast(err.message, { type: 'error', duration: err.conflict ? 7000 : 4000 })
      if (err.conflict) {
        setConfirmDelete(null)
        await onChanged()
      }
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="grid grid-cols-1 gap-6">
      <PageHeader
        title="Load checks"
        description="Each check records every phone's data balance, promo and GOMO screenshots for one day."
        actions={
          <Button onClick={onNewCheck}>
            <ClipboardPlus aria-hidden="true" /> New load check
          </Button>
        }
      />

      {checks.length === 0 && (
        <EmptyState
          icon={ClipboardList}
          title="No load checks yet"
          description="Start one to record each driver's current data, availed load and 2 screenshots from the GOMO app."
          action={<Button onClick={onNewCheck}><ClipboardPlus aria-hidden="true" /> New load check</Button>}
        />
      )}

      <div className="grid grid-cols-1 gap-4">
        {checks.map((check) => {
          const isOpen = open.has(check.date)
          const entries = [...check.entries].sort((a, b) => order(a.driverId) - order(b.driverId))
          const low = entries.filter((e) => entryStatus(e).data === 'low').length
          const shots = entries.reduce((n, e) => n + (e.screenshotId ? 1 : 0) + (e.screenshot2Id ? 1 : 0), 0)
          const panelId = `check-${check.date}`
          return (
            <Card key={check.date} className="overflow-hidden">
              <div className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
                <button
                  type="button"
                  onClick={() => toggle(check.date)}
                  aria-expanded={isOpen}
                  aria-controls={panelId}
                  className="-ml-2 flex min-w-0 flex-1 items-center gap-3 rounded-md px-2 py-1 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  <ChevronDown className={cn('size-4 shrink-0 text-muted-foreground transition-transform duration-200', !isOpen && '-rotate-90')} aria-hidden="true" />
                  <span className="grid min-w-0 gap-0.5">
                    <span className="font-semibold tracking-tight">{formatDate(check.date, { weekday: true })}</span>
                    <span className="text-xs text-muted-foreground">
                      Updated by {check.updatedBy || '—'} · {entries.length} phone{entries.length === 1 ? '' : 's'} · {shots} screenshot{shots === 1 ? '' : 's'}
                    </span>
                  </span>
                </button>
                <div className="flex items-center gap-2">
                  {low > 0 && <Badge variant="danger">{low} low data</Badge>}
                  {check.date === today && <Badge variant="secondary">Today</Badge>}
                  <Button variant="outline" size="sm" onClick={() => onEditCheck(check.date)}>
                    <Pencil aria-hidden="true" /> Edit
                  </Button>
                  <Button variant="ghost" size="icon-sm" className="hover:text-destructive" onClick={() => {
                    setConfirmDelete(check.date)
                    setDeleteVersion(check.version ?? null)
                  }} aria-label={`Delete load check for ${formatDate(check.date)}`}>
                    <Trash2 />
                  </Button>
                </div>
              </div>

              {isOpen && (
                <Table id={panelId} className="border-t">
                  <thead className="bg-muted/40">
                    <tr className="border-b">
                      <th className={th}>Driver</th>
                      <th className={th}>Current data</th>
                      <th className={th}>Availed load</th>
                      <th className={th}>Expires</th>
                      <th className={th}>Remarks</th>
                      <th className={th}>Screenshots</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {entries.map((e) => {
                      const d = driverById[e.driverId]
                      return (
                        <tr key={e.driverId} className="transition-colors hover:bg-muted/40">
                          <td className={td}>
                            <div className="font-medium">{d?.label || e.driverId}</div>
                            <div className="max-w-56 truncate text-xs text-muted-foreground">{d?.user}</div>
                          </td>
                          <td className={td}><DataCell value={e.currentData} /></td>
                          <td className={cn(td, 'max-w-48 text-[13px]')}>{e.load || <span className="text-muted-foreground">—</span>}</td>
                          <td className={td}><ExpiryCell entry={e} today={check.date} /></td>
                          <td className={cn(td, 'max-w-48 text-[13px]', e.remarks ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground')}>{e.remarks || '—'}</td>
                          <td className={td}>
                            <ShotsButton entry={e} title={d?.label || 'Driver'} subtitle={`${d?.user || ''} · ${formatDate(check.date)}`} />
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </Table>
              )}
            </Card>
          )
        })}
      </div>

      <Dialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        busy={deleting}
        title="Delete this load check?"
        description={confirmDelete ? `All rows for ${formatDate(confirmDelete)} are removed from the sheet. Screenshot files stay in the Drive folder.` : ''}
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirmDelete(null)} disabled={deleting}>Cancel</Button>
            <Button variant="destructive" onClick={doDelete} loading={deleting}>Delete check</Button>
          </>
        }
      >
        <p className="text-sm text-muted-foreground">This can't be undone from the app.</p>
      </Dialog>
    </div>
  )
}
