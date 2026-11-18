import { cn } from '../lib/cn.js'

export function PageHeader({ title, description, actions, children }) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="grid gap-1">
        {children}
        <h1 className="text-2xl font-semibold tracking-tight text-balance">{title}</h1>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function StatCard({ label, value, hint, icon: Icon, tone = 'default' }) {
  return (
    <div className="rounded-xl border bg-card p-5 shadow-xs">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        {Icon && (
          <span
            className={cn(
              'grid size-8 place-items-center rounded-md border',
              tone === 'danger' && 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300',
              tone === 'warning' && 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-300',
              tone === 'default' && 'text-muted-foreground',
            )}
            aria-hidden="true"
          >
            <Icon className="size-4" />
          </span>
        )}
      </div>
      <p className="mt-3 text-3xl font-semibold tracking-tight tabular-nums">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

export function EmptyState({ icon: Icon, title, description, action }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed px-6 py-14 text-center">
      {Icon && (
        <span className="grid size-10 place-items-center rounded-lg border bg-card text-muted-foreground" aria-hidden="true">
          <Icon className="size-5" />
        </span>
      )}
      <div className="grid gap-1">
        <p className="font-medium">{title}</p>
        {description && <p className="max-w-sm text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  )
}

/** Shared table look: header row tint, row dividers, horizontal scroll inside the card only. */
export function Table({ children, className, ...props }) {
  return (
    // `relative` keeps absolutely positioned children (e.g. sr-only header labels) inside the
    // scroller; without it they widen the whole page on phones.
    <div className={cn('relative overflow-x-auto', className)} {...props}>
      <table className="w-full text-sm">{children}</table>
    </div>
  )
}
export const th = 'h-10 px-4 text-left align-middle text-xs font-medium whitespace-nowrap text-muted-foreground'
export const td = 'px-4 py-3 align-middle'
