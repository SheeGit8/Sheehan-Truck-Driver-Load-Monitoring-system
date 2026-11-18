import { LOW_DATA_GB, formatDate, parseGb, todayIso } from '../lib/format.js'
import { ShotsButton } from './Screenshots.jsx'
import { DataCell, ExpiryCell } from './Status.jsx'
import { cn } from '../lib/cn.js'
import { Dialog } from './ui.jsx'

/** Every recorded check for one driver, oldest → newest chart plus a table. */
export function DriverHistory({ driver, checks, onClose }) {
  const today = todayIso()
  const rows = driver
    ? checks
        .map((c) => ({ check: c, entry: c.entries.find((e) => e.driverId === driver.id) }))
        .filter((r) => r.entry)
    : []
  const points = [...rows].reverse().map((r) => ({ date: r.check.date, gb: parseGb(r.entry.currentData) })).filter((p) => p.gb !== null)
  const max = Math.max(LOW_DATA_GB * 2, ...points.map((p) => p.gb))

  return (
    <Dialog
      open={!!driver}
      onClose={onClose}
      title={driver ? `${driver.label} · history` : ''}
      description={driver ? `${driver.user} · SIM ${driver.sim || '—'}` : ''}
      className="max-w-3xl"
    >
      {driver && rows.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">No load checks recorded for this phone yet.</p>}

      {points.length > 1 && (
        <figure className="mb-5 rounded-lg border p-4">
          <figcaption className="mb-3 flex items-center justify-between text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Data left per check (GB)</span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-px w-4 border-t border-dashed border-red-500" aria-hidden="true" /> {LOW_DATA_GB} GB low-data line
            </span>
          </figcaption>
          <div className="relative flex h-36 items-end gap-2" role="img" aria-label={`Data left: ${points.map((p) => `${formatDate(p.date, { withYear: false })} ${p.gb} GB`).join(', ')}`}>
            <div className="pointer-events-none absolute inset-x-0 border-t border-dashed border-red-500/70" style={{ bottom: `${(LOW_DATA_GB / max) * 100}%` }} />
            {points.map((p) => (
              <div key={p.date} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
                <span className="font-mono text-[11px] tabular-nums text-muted-foreground">{p.gb.toFixed(1)}</span>
                <div
                  className={cn('w-full max-w-10 rounded-t-sm', p.gb < LOW_DATA_GB ? 'bg-red-500' : 'bg-foreground/80')}
                  style={{ height: `${Math.max(2, (p.gb / max) * 100)}%` }}
                />
              </div>
            ))}
          </div>
          <div className="mt-1.5 flex gap-2" aria-hidden="true">
            {points.map((p) => (
              <span key={p.date} className="flex-1 truncate text-center text-[11px] text-muted-foreground">{formatDate(p.date, { withYear: false })}</span>
            ))}
          </div>
        </figure>
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Check date</th>
                <th className="px-3 py-2 font-medium">Current data</th>
                <th className="px-3 py-2 font-medium">Expires</th>
                <th className="px-3 py-2 font-medium">Remarks</th>
                <th className="px-3 py-2 font-medium">Shots</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map(({ check, entry }) => (
                <tr key={check.date} className="align-top">
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    {formatDate(check.date)}
                    <div className="text-xs text-muted-foreground">by {check.updatedBy || '—'}</div>
                  </td>
                  <td className="px-3 py-2.5"><DataCell value={entry.currentData} compact /></td>
                  <td className="px-3 py-2.5"><ExpiryCell entry={entry} today={today} /></td>
                  <td className="px-3 py-2.5 text-muted-foreground">{entry.remarks || '—'}</td>
                  <td className="px-3 py-2.5">
                    <ShotsButton entry={entry} title={driver.label} subtitle={`Load check ${formatDate(check.date)}`} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Dialog>
  )
}
