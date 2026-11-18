/* Small shadcn/ui-style primitives, written by hand so the single-file build stays light. */
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { CircleAlert, CircleCheck, LoaderCircle, X } from 'lucide-react'

import { cn } from '../lib/cn.js'
import { ToastCtx } from '../lib/contexts.js'

const focusRing =
  'outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:border-ring'

const buttonVariants = {
  default: 'bg-primary text-primary-foreground shadow-xs hover:bg-primary/90',
  outline: 'border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground dark:bg-input/30 dark:border-input dark:hover:bg-input/50',
  secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
  ghost: 'hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50',
  destructive: 'bg-destructive text-white shadow-xs hover:bg-destructive/90',
  link: 'text-foreground underline-offset-4 hover:underline',
}
const buttonSizes = {
  sm: 'h-8 gap-1.5 rounded-md px-3 text-[13px]',
  default: 'h-9 gap-2 rounded-md px-4 text-sm',
  lg: 'h-10 gap-2 rounded-md px-6 text-sm',
  icon: 'size-9 rounded-md',
  'icon-sm': 'size-8 rounded-md',
}

export function Button({ variant = 'default', size = 'default', loading = false, className, children, disabled, ...props }) {
  return (
    <button
      type="button"
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex shrink-0 items-center justify-center font-medium whitespace-nowrap transition-[color,background-color,box-shadow] duration-150 select-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
        focusRing,
        buttonVariants[variant],
        buttonSizes[size],
        className,
      )}
      {...props}
    >
      {loading && <LoaderCircle className="animate-spin" aria-hidden="true" />}
      {children}
    </button>
  )
}

export function Card({ className, ...props }) {
  return <div className={cn('rounded-xl border bg-card text-card-foreground shadow-xs', className)} {...props} />
}
export function CardHeader({ className, ...props }) {
  return <div className={cn('flex flex-col gap-1.5 px-5 pt-5', className)} {...props} />
}
export function CardTitle({ as: Tag = 'h3', className, ...props }) {
  return <Tag className={cn('text-base leading-none font-semibold tracking-tight', className)} {...props} />
}
export function CardDescription({ className, ...props }) {
  return <p className={cn('text-sm text-muted-foreground', className)} {...props} />
}
export function CardContent({ className, ...props }) {
  return <div className={cn('px-5 pb-5', className)} {...props} />
}

const inputBase =
  'w-full min-w-0 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs transition-[color,box-shadow] placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40'

export function Input({ className, ...props }) {
  return <input className={cn(inputBase, 'h-9 py-1', focusRing, className)} {...props} />
}

export function Textarea({ className, ...props }) {
  return <textarea className={cn(inputBase, 'min-h-16 py-2', focusRing, className)} {...props} />
}

export function Label({ className, ...props }) {
  return <label className={cn('text-[13px] leading-none font-medium select-none', className)} {...props} />
}

/** Label + control + helper/error text, wired with ids for screen readers. */
export function Field({ id: idProp, label, hint, error, required, className, children }) {
  const autoId = useId()
  const id = idProp || autoId
  const hintId = hint ? `${id}-hint` : undefined
  const errId = error ? `${id}-err` : undefined
  return (
    <div className={cn('grid gap-2', className)}>
      <Label htmlFor={id}>
        {label}
        {required && <span className="text-destructive" aria-hidden="true"> *</span>}
      </Label>
      {children({ id, 'aria-describedby': [hintId, errId].filter(Boolean).join(' ') || undefined, 'aria-invalid': error ? true : undefined, required })}
      {error ? (
        <p id={errId} className="text-xs text-destructive">{error}</p>
      ) : hint ? (
        <p id={hintId} className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  )
}

const badgeVariants = {
  default: 'border-transparent bg-primary text-primary-foreground',
  secondary: 'border-transparent bg-secondary text-secondary-foreground',
  outline: 'text-foreground',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300',
  warning: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-300',
  danger: 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300',
  muted: 'border-transparent bg-muted text-muted-foreground',
}

export function Badge({ variant = 'outline', className, ...props }) {
  return (
    <span
      className={cn(
        'inline-flex w-fit shrink-0 items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap [&_svg]:size-3 [&_svg]:shrink-0',
        badgeVariants[variant],
        className,
      )}
      {...props}
    />
  )
}

export function Switch({ checked, onCheckedChange, className, ...props }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-transparent shadow-xs transition-colors',
        focusRing,
        checked ? 'bg-primary' : 'bg-input dark:bg-input/80',
        className,
      )}
      {...props}
    >
      <span
        className={cn(
          'pointer-events-none block size-4 rounded-full bg-background shadow-sm ring-0 transition-transform dark:bg-foreground',
          checked ? 'translate-x-4 dark:bg-primary-foreground' : 'translate-x-0.5',
        )}
      />
    </button>
  )
}

export function Skeleton({ className }) {
  return <div className={cn('animate-pulse rounded-md bg-muted', className)} />
}

export function Separator({ className }) {
  return <div role="separator" className={cn('h-px w-full bg-border', className)} />
}

/**
 * Modal built on <dialog>: focus trap, Esc to close and backdrop come from the browser.
 * `onClose` runs for Esc, the X button and backdrop clicks; while `busy` (e.g. saving)
 * those are ignored so the dialog stays open.
 */
export function Dialog({ open, onClose, title, description, children, footer, className, busy = false }) {
  const ref = useRef(null)
  const titleId = useId()
  const descId = useId()

  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])

  const requestClose = () => {
    if (!busy) onClose()
  }

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onCancel={(e) => {
        e.preventDefault()
        requestClose()
      }}
      onClick={(e) => {
        if (e.target === ref.current) requestClose()
      }}
      className={cn(
        'm-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg overflow-hidden rounded-xl border bg-background p-0 text-foreground shadow-lg',
        className,
      )}
    >
      {open && (
        <div className="flex max-h-[calc(100dvh-2rem)] flex-col">
          <div className="flex items-start justify-between gap-4 border-b px-5 py-4">
            <div className="grid gap-1">
              <h2 id={titleId} className="text-base font-semibold tracking-tight">{title}</h2>
              {description && <p id={descId} className="text-sm text-muted-foreground">{description}</p>}
            </div>
            <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={requestClose} disabled={busy} className="-mt-1 -mr-2">
              <X />
            </Button>
          </div>
          <div className="overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="flex flex-col-reverse gap-2 border-t bg-muted/40 px-5 py-3 sm:flex-row sm:justify-end">{footer}</div>}
        </div>
      )}
    </dialog>
  )
}

/* ---------- Toasts ---------- */

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const push = useCallback((message, { type = 'success', duration = 4000 } = {}) => {
    const id = Math.random().toString(36).slice(2)
    setToasts((t) => [...t, { id, message, type }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), duration)
  }, [])
  const dismiss = (id) => setToasts((t) => t.filter((x) => x.id !== id))

  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-4 bottom-4 z-50 flex flex-col items-center gap-2 sm:inset-x-auto sm:right-4 sm:items-end">
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.type === 'error' ? 'alert' : 'status'}
            className="pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-lg border bg-popover px-4 py-3 text-sm shadow-lg"
          >
            {t.type === 'error' ? (
              <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
            ) : (
              <CircleCheck className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
            )}
            <p className="flex-1">{t.message}</p>
            <button type="button" onClick={() => dismiss(t.id)} aria-label="Dismiss" className={cn('-m-1 rounded p-1 text-muted-foreground hover:text-foreground', focusRing)}>
              <X className="size-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}
