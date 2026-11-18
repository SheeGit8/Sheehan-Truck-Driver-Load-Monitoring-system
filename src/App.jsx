import { useCallback, useEffect, useRef, useState } from 'react'
import { ClipboardList, LayoutDashboard, Moon, RefreshCw, Sun, Truck, TriangleAlert, Users } from 'lucide-react'
import { ViewerProvider } from './components/Screenshots.jsx'
import { cn } from './lib/cn.js'
import { Badge, Button, Skeleton, ToastProvider } from './components/ui.jsx'
import { api, isDemo } from './lib/api.js'
import { resetDemo } from './lib/mock.js'
import { CheckEditor } from './views/CheckEditor.jsx'
import { Checks } from './views/Checks.jsx'
import { Drivers } from './views/Drivers.jsx'
import { Overview } from './views/Overview.jsx'

const NAV = [
  { key: 'overview', label: 'Overview', icon: LayoutDashboard },
  { key: 'checks', label: 'Load checks', icon: ClipboardList },
  { key: 'drivers', label: 'Drivers', icon: Users },
]

function useTheme() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))
  const toggle = () => {
    const next = !dark
    document.documentElement.classList.toggle('dark', next)
    try {
      localStorage.setItem('slm-theme', next ? 'dark' : 'light')
    } catch {
      /* ignore */
    }
    setDark(next)
  }
  return [dark, toggle]
}

export default function App() {
  return (
    <ToastProvider>
      <ViewerProvider>
        <Shell />
      </ViewerProvider>
    </ToastProvider>
  )
}

function Shell() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [refreshing, setRefreshing] = useState(false)
  // route: { view: 'overview' | 'checks' | 'drivers' | 'editor', editDate?: string|null }
  const [route, setRoute] = useState({ view: 'overview' })
  const [dark, toggleTheme] = useTheme()
  const mainRef = useRef(null)

  const load = useCallback(async () => {
    setRefreshing(true)
    try {
      const d = await api.getAppData()
      setData(d)
      setError(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setRefreshing(false)
    }
  }, [])

  // First load. Later reloads (after saving, or the reload button) go through load().
  useEffect(() => {
    let alive = true
    api.getAppData().then(
      (d) => alive && setData(d),
      (err) => alive && setError(err.message),
    )
    return () => {
      alive = false
    }
  }, [])

  const go = (next) => {
    setRoute(next)
    window.scrollTo({ top: 0 })
    // Move focus to the new page for keyboard and screen reader users.
    requestAnimationFrame(() => mainRef.current?.focus({ preventScroll: true }))
  }

  const newCheck = () => go({ view: 'editor', editDate: null })
  const editCheck = (date) => go({ view: 'editor', editDate: date })
  const navKey = route.view === 'editor' ? 'checks' : route.view

  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#main" className="sr-only z-50 rounded-md bg-background px-3 py-2 text-sm font-medium shadow focus:not-sr-only focus:fixed focus:top-2 focus:left-2">
        Skip to content
      </a>

      <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4 sm:px-6">
          <button type="button" onClick={() => go({ view: 'overview' })} className="flex items-center gap-2.5 rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
            <span className="grid size-8 place-items-center rounded-lg bg-brand text-white shadow-xs" aria-hidden="true">
              <Truck className="size-4" />
            </span>
            <span className="grid text-left leading-tight">
              <span className="text-sm font-semibold tracking-tight">Sheehan</span>
              <span className="text-xs text-muted-foreground">Load Monitor</span>
            </span>
          </button>

          <nav aria-label="Main" className="ml-4 hidden items-center gap-1 md:flex">
            {NAV.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                type="button"
                onClick={() => go({ view: key })}
                aria-current={navKey === key ? 'page' : undefined}
                className={cn(
                  'inline-flex h-8 items-center gap-2 rounded-md px-3 text-sm font-medium transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                  navKey === key ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
                )}
              >
                <Icon className="size-4" aria-hidden="true" />
                {label}
              </button>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-1.5">
            {isDemo && (
              <Badge variant="warning" title="Not connected to Google Sheets. Changes are kept in this browser only.">
                Demo data
              </Badge>
            )}
            <Button variant="ghost" size="icon" onClick={load} disabled={refreshing || !data} aria-label="Reload data from the sheet" title="Reload">
              <RefreshCw className={cn(refreshing && data && 'animate-spin')} />
            </Button>
            <Button variant="ghost" size="icon" onClick={toggleTheme} aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'} title="Theme">
              {dark ? <Sun /> : <Moon />}
            </Button>
          </div>
        </div>

        {/* Small screens: nav as a full-width segmented row */}
        <nav aria-label="Main" className="mx-auto grid max-w-6xl grid-cols-3 gap-1 px-4 pb-2 md:hidden">
          {NAV.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => go({ view: key })}
              aria-current={navKey === key ? 'page' : undefined}
              className={cn(
                'inline-flex h-10 items-center justify-center gap-1.5 rounded-md text-[13px] font-medium transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                navKey === key ? 'bg-accent text-foreground' : 'text-muted-foreground',
              )}
            >
              <Icon className="size-4" aria-hidden="true" />
              {label}
            </button>
          ))}
        </nav>
      </header>

      <main id="main" ref={mainRef} tabIndex={-1} className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 outline-none sm:px-6">
        {error && !data ? (
          <LoadError message={error} onRetry={load} />
        ) : !data ? (
          <LoadingState />
        ) : route.view === 'editor' ? (
          <CheckEditor
            key={route.editDate || 'new'}
            data={data}
            editDate={route.editDate}
            onEditCheck={editCheck}
            onCancel={() => go({ view: 'checks' })}
            onDone={async () => {
              await load()
              go({ view: 'checks' })
            }}
          />
        ) : route.view === 'checks' ? (
          <Checks data={data} onNewCheck={newCheck} onEditCheck={editCheck} onChanged={load} />
        ) : route.view === 'drivers' ? (
          <Drivers data={data} onChanged={load} />
        ) : (
          <Overview data={data} onNewCheck={newCheck} />
        )}
      </main>

      {route.view !== 'editor' && (
        <footer className="border-t">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-4 text-xs text-muted-foreground sm:px-6">
            <span>Sheehan Driver Load Monitoring · data stored in Google Sheets, screenshots in Google Drive</span>
            {isDemo && (
              <button
                type="button"
                className="underline-offset-4 hover:text-foreground hover:underline"
                onClick={() => {
                  resetDemo()
                  load()
                }}
              >
                Reset demo data
              </button>
            )}
          </div>
        </footer>
      )}
    </div>
  )
}

function LoadingState() {
  return (
    <div className="grid gap-6" aria-busy="true" aria-label="Loading data">
      <div className="grid gap-2">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
      </div>
      <Skeleton className="h-96 rounded-xl" />
    </div>
  )
}

function LoadError({ message, onRetry }) {
  return (
    <div role="alert" className="mx-auto mt-10 grid max-w-md justify-items-center gap-3 rounded-xl border bg-card p-8 text-center">
      <TriangleAlert className="size-6 text-destructive" aria-hidden="true" />
      <p className="font-medium">Couldn’t load the sheet</p>
      <p className="text-sm text-muted-foreground">{message}</p>
      <Button variant="outline" onClick={onRetry}>
        <RefreshCw aria-hidden="true" /> Try again
      </Button>
    </div>
  )
}
