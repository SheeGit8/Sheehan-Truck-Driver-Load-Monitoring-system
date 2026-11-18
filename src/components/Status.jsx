import { CircleAlert, Clock, TriangleAlert } from 'lucide-react'
import { LOW_DATA_GB, entryStatus, expiryText, formatDate, formatGb } from '../lib/format.js'
import { cn } from '../lib/cn.js'
import { Badge } from './ui.jsx'

const BAR_MAX_GB = 60

/** "38.13 GB" with a thin bar; red + "Low" label under LOW_DATA_GB. */
export function DataCell({ value, compact = false }) {
  const { data, gb } = entryStatus({ currentData: value })
  if (data === 'none') return <span className="text-muted-foreground">—</span>
  const isNumber = /^-?\d+(\.\d+)?$/.test(String(value).trim())
  const pct = Math.max(2, Math.min(100, (gb / Math.max(BAR_MAX_GB, gb)) * 100))
  return (
    <div className={cn('grid gap-1.5', compact ? 'min-w-24' : 'min-w-32')}>
      <div className="flex items-center gap-2">
        <span className={cn('font-mono text-sm tabular-nums', data === 'low' && 'font-medium text-red-700 dark:text-red-400')}>
          {isNumber ? formatGb(value) : value}
        </span>
        {data === 'low' && (
          <Badge variant="danger" title={`Less than ${LOW_DATA_GB} GB left`}>
            <CircleAlert aria-hidden="true" />
            Low
          </Badge>
        )}
      </div>
      {isNumber && (
        <div className="h-1 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
          <div className={cn('h-full rounded-full', data === 'low' ? 'bg-red-500' : 'bg-foreground/70')} style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  )
}

export function ExpiryCell({ entry, today }) {
  const { expiry, daysLeft } = entryStatus(entry, today)
  if (expiry === 'none') return <span className="text-muted-foreground">—</span>
  return (
    <div className="grid gap-1">
      <span className="text-sm whitespace-nowrap tabular-nums">
        {formatDate(entry.expDate)}
        {entry.expTime && <span className="text-muted-foreground"> · {entry.expTime}</span>}
      </span>
      <ExpiryBadge expiry={expiry} daysLeft={daysLeft} />
    </div>
  )
}

export function ExpiryBadge({ expiry, daysLeft }) {
  if (expiry === 'expired') {
    return (
      <Badge variant="danger">
        <TriangleAlert aria-hidden="true" /> Expired {expiryText(daysLeft)}
      </Badge>
    )
  }
  if (expiry === 'soon') {
    return (
      <Badge variant="warning">
        <Clock aria-hidden="true" /> Ends {expiryText(daysLeft)}
      </Badge>
    )
  }
  if (expiry === 'active') return <Badge variant="success">Active · ends {expiryText(daysLeft)}</Badge>
  return null
}
