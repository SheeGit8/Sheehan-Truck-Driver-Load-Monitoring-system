import { useEffect, useRef, useState } from 'react'
import { Camera, ExternalLink, Eye, ImageOff, ImagePlus, Images, LoaderCircle, RefreshCw, Trash2 } from 'lucide-react'
import { driveLink, loadScreenshot, loadThumb } from '../lib/api.js'
import { compressImage, imageFromTransfer } from '../lib/image.js'
import { cn } from '../lib/cn.js'
import { ViewerCtx, useToast, useViewer } from '../lib/contexts.js'
import { Button, Dialog } from './ui.jsx'

/** A shot is { fileId } (saved in Drive) or { dataUrl } (picked but not uploaded yet). */
function useShotUrl(shot) {
  const fileId = shot?.fileId
  // Remember which file the result belongs to, so a changed fileId never shows a stale image.
  const [state, setState] = useState({ id: null, url: null, error: null })

  useEffect(() => {
    if (!fileId) return
    let alive = true
    loadScreenshot(fileId).then(
      (url) => alive && setState({ id: fileId, url, error: null }),
      (err) => alive && setState({ id: fileId, url: null, error: err.message }),
    )
    return () => {
      alive = false
    }
  }, [fileId])

  if (shot?.dataUrl) return { url: shot.dataUrl, error: null, loading: false }
  if (!fileId) return { url: null, error: null, loading: false }
  if (state.id !== fileId) return { url: null, error: null, loading: true }
  return { url: state.url, error: state.error, loading: false }
}

function ShotImage({ shot, alt, className }) {
  const { url, error, loading } = useShotUrl(shot)
  if (loading) {
    return (
      <div className={cn('flex items-center justify-center bg-muted', className)}>
        <LoaderCircle className="size-5 animate-spin text-muted-foreground" aria-label="Loading screenshot" />
      </div>
    )
  }
  if (error || !url) {
    return (
      <div className={cn('flex flex-col items-center justify-center gap-1 bg-muted p-3 text-center text-xs text-muted-foreground', className)}>
        <ImageOff className="size-5" aria-hidden="true" />
        {error || 'No image'}
      </div>
    )
  }
  return <img src={url} alt={alt} className={cn('bg-muted object-cover object-top', className)} />
}

/* ---------- Viewer (one shared dialog for the whole app) ---------- */

export function ViewerProvider({ children }) {
  const [view, setView] = useState(null)
  return (
    <ViewerCtx.Provider value={setView}>
      {children}
      <Dialog
        open={!!view}
        onClose={() => setView(null)}
        title={view?.title || 'Screenshots'}
        description={view?.subtitle}
        className="max-w-3xl"
      >
        {view && (
          <div className={cn('grid gap-4', view.shots.length > 1 && 'sm:grid-cols-2')}>
            {view.shots.map((s, i) => {
              const link = s.fileId ? driveLink(s.fileId) : null
              return (
                <figure key={s.fileId || i} className="grid gap-2">
                  <ShotImage shot={s} alt={`${view.title}, screenshot ${i + 1}`} className="max-h-[70dvh] w-full rounded-lg border object-contain" />
                  <figcaption className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>Screenshot {s.slot || i + 1}</span>
                    {link && (
                      <a href={link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-foreground underline-offset-4 hover:underline">
                        Open in Drive <ExternalLink className="size-3" aria-hidden="true" />
                      </a>
                    )}
                  </figcaption>
                </figure>
              )
            })}
          </div>
        )}
      </Dialog>
    </ViewerCtx.Provider>
  )
}

/** True once the element has come near the screen, so thumbnails further down load only when needed. */
function useNearScreen(ref) {
  const [near, setNear] = useState(() => typeof IntersectionObserver === 'undefined')
  useEffect(() => {
    const el = ref.current
    if (near || !el) return
    const io = new IntersectionObserver((items) => {
      if (items.some((i) => i.isIntersecting)) {
        setNear(true)
        io.disconnect()
      }
    }, { rootMargin: '300px' })
    io.observe(el)
    return () => io.disconnect()
  }, [near, ref])
  return near
}

// Thumbnail sizes (9:16 like a phone screen). "lg" is used on phones, where they sit under the driver's name.
const THUMB_SIZES = {
  md: 'h-32 w-[4.5rem]',
  lg: 'h-40 w-[5.625rem]',
}

function Thumb({ fileId, label, onOpen, size = 'md' }) {
  const ref = useRef(null)
  const near = useNearScreen(ref)
  const [state, setState] = useState({ id: null, url: null })

  useEffect(() => {
    if (!near || !fileId) return
    let alive = true
    loadThumb(fileId).then(
      (url) => alive && setState({ id: fileId, url }),
      () => alive && setState({ id: fileId, url: null }),
    )
    return () => {
      alive = false
    }
  }, [near, fileId])

  const ready = state.id === fileId
  return (
    <button
      ref={ref}
      type="button"
      onClick={onOpen}
      aria-label={`${label}: open full size`}
      title="Open full size"
      className={cn('relative grid shrink-0 place-items-center overflow-hidden rounded-md border bg-muted transition-shadow outline-none hover:ring-2 hover:ring-ring/40 focus-visible:ring-[3px] focus-visible:ring-ring/50', THUMB_SIZES[size] || THUMB_SIZES.md)}
    >
      {ready && state.url ? (
        <img src={state.url} alt="" className="size-full object-cover object-top" />
      ) : ready ? (
        <ImageOff className="size-4 text-muted-foreground" aria-hidden="true" />
      ) : (
        <span className="absolute inset-0 animate-pulse bg-muted-foreground/15" aria-hidden="true" />
      )}
    </button>
  )
}

/** The entry's screenshots as small previews that load by themselves. Tap one to see it full size. */
export function ShotThumbs({ entry, title, subtitle, size = 'md' }) {
  const open = useViewer()
  const shots = [
    entry?.screenshotId && { fileId: entry.screenshotId, slot: 1 },
    entry?.screenshot2Id && { fileId: entry.screenshot2Id, slot: 2 },
  ].filter(Boolean)
  if (!shots.length) return <span className="text-xs text-muted-foreground">None</span>
  return (
    <div className="flex gap-2">
      {shots.map((s) => (
        <Thumb key={s.fileId} fileId={s.fileId} size={size} label={`${title}, screenshot ${s.slot}`} onOpen={() => open({ title, subtitle, shots })} />
      ))}
    </div>
  )
}

/* ---------- Upload slot used in the load check editor ---------- */

/** True on phones and tablets (finger instead of mouse), where Camera / Gallery buttons make sense. */
function useTouchDevice() {
  const query = '(pointer: coarse)'
  const [touch, setTouch] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(query).matches)
  useEffect(() => {
    const mq = window.matchMedia?.(query)
    if (!mq) return
    const update = () => setTouch(mq.matches)
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])
  return touch
}

export function ScreenshotSlot({ slot, value, onChange, driverLabel }) {
  const inputRef = useRef(null) // gallery / files
  const cameraRef = useRef(null) // opens the camera directly on phones
  const touch = useTouchDevice()
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const toast = useToast()
  const open = useViewer()

  const accept = async (file) => {
    if (!file) return
    setBusy(true)
    try {
      onChange({ dataUrl: await compressImage(file) })
    } catch (err) {
      toast(err.message, { type: 'error' })
    } finally {
      setBusy(false)
    }
  }

  const pick = () => inputRef.current?.click()
  const snap = () => cameraRef.current?.click()
  const label = `Screenshot ${slot}`
  const onFile = (e) => {
    accept(e.target.files?.[0])
    e.target.value = ''
  }

  return (
    <div className="grid w-full gap-1.5">
      <span className="text-[13px] font-medium" aria-hidden="true">{label}</span>
      <input ref={inputRef} type="file" accept="image/*" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={onFile} />
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={onFile} />
      {value ? (
        <div className="group relative">
          <button
            type="button"
            onClick={() => open({ title: driverLabel, subtitle: label, shots: [{ ...value, slot }] })}
            onPaste={(e) => {
              const f = imageFromTransfer(e.clipboardData)
              if (f) {
                e.preventDefault()
                accept(f)
              }
            }}
            className="block w-full overflow-hidden rounded-lg border outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            aria-label={`View ${label} for ${driverLabel}`}
          >
            <ShotImage shot={value} alt="" className="aspect-[9/16] w-full" />
          </button>
          {value.dataUrl && (
            <span className="absolute top-1.5 left-1.5 rounded bg-primary px-1.5 py-0.5 text-[10px] font-medium text-primary-foreground">New</span>
          )}
          <div className="mt-1.5 flex gap-1">
            {touch && (
              <Button variant="outline" size="icon-sm" className="flex-1" onClick={snap} aria-label={`Retake ${label} with the camera`} title="Camera">
                <Camera />
              </Button>
            )}
            <Button variant="outline" size="icon-sm" className="flex-1" onClick={pick} aria-label={touch ? `Replace ${label} from the gallery` : `Replace ${label}`} title={touch ? 'Gallery' : 'Replace'}>
              {touch ? <Images /> : <RefreshCw />}
            </Button>
            {!touch && (
              <Button variant="outline" size="icon-sm" className="flex-1" onClick={() => open({ title: driverLabel, subtitle: label, shots: [{ ...value, slot }] })} aria-label={`View ${label}`} title="View">
                <Eye />
              </Button>
            )}
            <Button variant="outline" size="icon-sm" className="flex-1 hover:text-destructive" onClick={() => onChange(null)} aria-label={`Remove ${label}`} title="Remove">
              <Trash2 />
            </Button>
          </div>
        </div>
      ) : touch ? (
        <div className="flex aspect-[9/16] w-full flex-col items-stretch justify-center gap-2 rounded-lg border border-dashed p-2 text-center">
          {busy ? (
            <span className="flex flex-col items-center gap-1.5 text-muted-foreground" role="status">
              <LoaderCircle className="size-5 animate-spin" aria-hidden="true" />
              <span className="text-xs font-medium">Preparing…</span>
            </span>
          ) : (
            <>
              <Button className="h-11 w-full gap-1.5 px-2" onClick={snap} aria-label={`Take a photo for ${label}, ${driverLabel}`}>
                <Camera aria-hidden="true" /> Camera
              </Button>
              <Button variant="outline" className="h-11 w-full gap-1.5 px-2" onClick={pick} aria-label={`Choose ${label} for ${driverLabel} from the gallery`}>
                <Images aria-hidden="true" /> Gallery
              </Button>
            </>
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={pick}
          onPaste={(e) => {
            const f = imageFromTransfer(e.clipboardData)
            if (f) {
              e.preventDefault()
              accept(f)
            }
          }}
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragging(false)
            accept(imageFromTransfer(e.dataTransfer))
          }}
          aria-label={`Add ${label} for ${driverLabel}: click to choose, drop, or paste an image`}
          className={cn(
            'flex aspect-[9/16] w-full flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed px-2 text-center text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50',
            dragging && 'border-foreground bg-accent text-foreground',
          )}
        >
          {busy ? <LoaderCircle className="size-5 animate-spin" aria-hidden="true" /> : <ImagePlus className="size-5" aria-hidden="true" />}
          <span className="text-xs font-medium">{busy ? 'Preparing…' : 'Add image'}</span>
          <span className="text-[11px] leading-tight">Click, drop or paste</span>
        </button>
      )}
    </div>
  )
}
