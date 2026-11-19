import { useEffect, useRef } from 'react'
import { Menu, Moon, RefreshCw, Sun, X } from 'lucide-react'
import logoUrl from '../assets/logo-mark.png'
import { cn } from '../lib/cn.js'

/** The Sheehan mark on a white tile (the logo has black in it, so it needs a light background). */
function Logo({ className }) {
  return (
    <span className={cn('grid shrink-0 place-items-center overflow-hidden rounded-xl bg-white shadow-sm', className)} aria-hidden="true">
      <img src={logoUrl} alt="" className="size-full object-contain" />
    </span>
  )
}

const iconBtn =
  'grid size-9 place-items-center rounded-lg text-sidebar-muted transition-colors outline-none hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-[3px] focus-visible:ring-white/30 disabled:pointer-events-none disabled:opacity-40'

function Brand({ onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-3 rounded-lg text-left outline-none focus-visible:ring-[3px] focus-visible:ring-white/30"
    >
      <Logo className="size-10" />
      <span className="grid leading-tight">
        <span className="text-[15px] font-semibold tracking-tight text-sidebar-foreground">Sheehan</span>
        <span className="text-xs text-sidebar-muted">Load Monitor</span>
      </span>
    </button>
  )
}

/**
 * The sidebar's contents: brand, main nav, and the reload/theme controls pinned to the bottom.
 * Rendered as a fixed column on desktop and inside the mobile drawer.
 */
function SidebarBody({ nav, current, onNavigate, onReload, refreshing, canReload, dark, onToggleTheme, badge, onClose }) {
  return (
    <div className="flex h-full flex-col bg-sidebar px-3 py-5 text-sidebar-foreground">
      <div className="flex items-center justify-between gap-2 px-2">
        <Brand onClick={() => onNavigate('overview')} />
        {onClose && (
          <button type="button" onClick={onClose} className={iconBtn} aria-label="Close menu">
            <X className="size-5" />
          </button>
        )}
      </div>

      <nav aria-label="Main" className="mt-8 grid gap-1">
        {nav.map(({ key, label, icon: Icon }) => {
          const active = current === key
          return (
            <button
              key={key}
              type="button"
              onClick={() => onNavigate(key)}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-white/30',
                active
                  ? 'bg-sidebar-accent text-sidebar-foreground'
                  : 'text-sidebar-muted hover:bg-sidebar-accent/60 hover:text-sidebar-foreground',
              )}
            >
              <Icon className="size-[18px] shrink-0" aria-hidden="true" />
              {label}
            </button>
          )
        })}
      </nav>

      <div className="mt-auto grid gap-3 px-2">
        {badge}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onReload}
            disabled={refreshing || !canReload}
            className={iconBtn}
            aria-label="Reload data from the sheet"
            title="Reload"
          >
            <RefreshCw className={cn('size-[18px]', refreshing && canReload && 'animate-spin')} />
          </button>
          <button
            type="button"
            onClick={onToggleTheme}
            className={iconBtn}
            aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
            title="Theme"
          >
            {dark ? <Sun className="size-[18px]" /> : <Moon className="size-[18px]" />}
          </button>
        </div>
      </div>
    </div>
  )
}

/** Fixed sidebar on md+ screens. */
export function Sidebar(props) {
  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 border-r border-sidebar-border md:block">
      <SidebarBody {...props} />
    </aside>
  )
}

/** Phone/tablet: top bar with a menu button that opens the sidebar as a slide-in drawer. */
export function MobileNav({ open, onOpenChange, badge, ...props }) {
  const ref = useRef(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (open && !el.open) el.showModal()
    if (!open && el.open) el.close()
  }, [open])

  return (
    <>
      <header className="sticky top-0 z-40 flex h-14 items-center gap-3 border-b border-sidebar-border bg-sidebar px-4 text-sidebar-foreground md:hidden">
        <button type="button" onClick={() => onOpenChange(true)} className={iconBtn} aria-label="Open menu" aria-expanded={open}>
          <Menu className="size-5" />
        </button>
        <Logo className="size-8 rounded-lg" />
        <span className="grid leading-tight">
          <span className="text-sm font-semibold tracking-tight">Sheehan</span>
          <span className="text-xs text-sidebar-muted">Load Monitor</span>
        </span>
        {badge && <div className="ml-auto">{badge}</div>}
      </header>

      <dialog
        ref={ref}
        aria-label="Menu"
        className="drawer m-0 h-dvh max-h-none w-72 max-w-[85vw] border-r border-sidebar-border bg-sidebar p-0 md:hidden"
        onClose={() => onOpenChange(false)}
        onClick={(e) => e.target === e.currentTarget && onOpenChange(false)} // backdrop click
      >
        <SidebarBody
          {...props}
          badge={badge}
          onClose={() => onOpenChange(false)}
          onNavigate={(key) => {
            onOpenChange(false)
            props.onNavigate(key)
          }}
        />
      </dialog>
    </>
  )
}
