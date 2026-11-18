import { useMemo, useState } from 'react'
import { CalendarCheck, CircleAlert, ClipboardPlus, History, Smartphone, TimerOff } from 'lucide-react'
import { DriverHistory } from '../components/DriverHistory.jsx'
import { EmptyState, PageHeader, StatCard, Table, td, th } from '../components/Layout.jsx'
import { ShotsButton } from '../components/Screenshots.jsx'
import { DataCell, ExpiryCell } from '../components/Status.jsx'
import { cn } from '../lib/cn.js'
import { Badge, Button, Card, CardDescription, CardTitle } from '../components/ui.jsx'
import { LOW_DATA_GB, daysBetween, entryStatus, formatDate, latestEntries, todayIso } from '../lib/format.js'

function agoText(days) {
  if (days === 0) return 'Today'
  const n = Math.abs(days)
  const unit = `${n} day${n === 1 ? '' : 's'}`
  return days > 0 ? `${unit} ago` : `Dated ${unit} ahead`
}

export function Overview({ data, onNewCheck }) {
  const { drivers, checks } = data
  const today = todayIso()
  const [filter, setFilter] = useState('all')
  const [historyFor, setHistoryFor] = useState(null)

  const rows = useMemo(() => {
    const latest = latestEntries(checks)
    return drivers
      .filter((d) => d.active)
      .map((d) => {
        const entry = latest[d.id]
        const status = entryStatus(entry, today)
        const attention = status.data === 'low' || status.expiry === 'expired' || status.expiry === 'soon' || !entry
        return { driver: d, entry, status, attention }
      })
  }, [drivers, checks, today])

  const lowCount = rows.filter((r) => r.status.data === 'low').length
  const expCount = rows.filter((r) => r.status.expiry === 'expired' || r.status.expiry === 'soon').length
  const lastCheck = checks[0]
  const lastAgo = lastCheck ? daysBetween(lastCheck.date, today) : null
  const shown = filter === 'attention' ? rows.filter((r) => r.attention) : rows
  const attentionCount = rows.filter((r) => r.attention).length

  return (
    <div className="grid grid-cols-1 gap-6">
      <PageHeader
        title="Overview"
        description={`Latest GOMO load status of every driver phone, as of ${formatDate(today, { weekday: true })}.`}
        actions={
          <Button onClick={onNewCheck}>
            <ClipboardPlus aria-hidden="true" /> New load check
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard label="Phones tracked" value={rows.length} hint="Included in load checks" icon={Smartphone} />
        <StatCard
          label="Low data"
          value={lowCount}
          hint={`Under ${LOW_DATA_GB} GB on last check`}
          icon={CircleAlert}
          tone={lowCount ? 'danger' : 'default'}
        />
        <StatCard
          label="Expiring / expired"
          value={expCount}
          hint="Promo ends within 2 days"
          icon={TimerOff}
          tone={expCount ? 'warning' : 'default'}
        />
        <StatCard
          label="Last check"
          value={lastCheck ? formatDate(lastCheck.date, { withYear: false }) : '—'}
          hint={lastCheck ? `${agoText(lastAgo)} · by ${lastCheck.updatedBy || '—'}` : 'No checks yet'}
          icon={CalendarCheck}
        />
      </div>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5 pb-4">
          <div className="grid gap-1.5">
            <CardTitle as="h2">Current status</CardTitle>
            <CardDescription>Newest entry per phone. Open History to see every check.</CardDescription>
          </div>
          <div className="inline-flex rounded-lg bg-muted p-1" role="group" aria-label="Filter phones">
            {[
              ['all', `All (${rows.length})`],
              ['attention', `Needs attention (${attentionCount})`],
            ].map(([key, label]) => (
              <button
                key={key}
                type="button"
                aria-pressed={filter === key}
                onClick={() => setFilter(key)}
                className={cn(
                  'h-7 rounded-md px-3 text-[13px] font-medium transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                  filter === key ? 'bg-background text-foreground shadow-xs dark:bg-input/40' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {shown.length === 0 ? (
          <div className="px-5 pb-5">
            <EmptyState
              icon={CalendarCheck}
              title={filter === 'attention' ? 'Nothing needs attention' : 'No phones tracked'}
              description={filter === 'attention' ? 'Every phone has enough data and an active promo.' : 'Add a driver on the Drivers page to start tracking.'}
            />
          </div>
        ) : (
          <Table className="border-t">
            <thead className="bg-muted/40">
              <tr className="border-b">
                <th className={th}>Driver</th>
                <th className={th}>Current data</th>
                <th className={th}>Availed load</th>
                <th className={th}>Expires</th>
                <th className={th}>Checked</th>
                <th className={th}>Screenshots</th>
                <th className={cn(th, 'text-right')}><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {shown.map(({ driver, entry }) => (
                <tr key={driver.id} className="transition-colors hover:bg-muted/40">
                  <td className={td}>
                    <div className="font-medium">{driver.label}</div>
                    <div className="max-w-56 truncate text-xs text-muted-foreground" title={driver.user}>{driver.user}</div>
                  </td>
                  <td className={td}>{entry ? <DataCell value={entry.currentData} /> : <Badge variant="muted">No record</Badge>}</td>
                  <td className={cn(td, 'max-w-48')}>
                    <span className="line-clamp-2 text-[13px]">{entry?.load || <span className="text-muted-foreground">—</span>}</span>
                    {entry?.remarks && <div className="mt-0.5 text-xs text-amber-700 dark:text-amber-400">{entry.remarks}</div>}
                  </td>
                  <td className={td}>{entry ? <ExpiryCell entry={entry} today={today} /> : <span className="text-muted-foreground">—</span>}</td>
                  <td className={cn(td, 'whitespace-nowrap text-muted-foreground')}>{entry ? formatDate(entry.checkDate, { withYear: false }) : '—'}</td>
                  <td className={td}>
                    {entry ? <ShotsButton entry={entry} title={driver.label} subtitle={`${driver.user} · ${formatDate(entry.checkDate)}`} /> : <span className="text-xs text-muted-foreground">None</span>}
                  </td>
                  <td className={cn(td, 'text-right')}>
                    <Button variant="ghost" size="sm" onClick={() => setHistoryFor(driver)}>
                      <History aria-hidden="true" /> History
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <DriverHistory driver={historyFor} checks={checks} onClose={() => setHistoryFor(null)} />
    </div>
  )
}
