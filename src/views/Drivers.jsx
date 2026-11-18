import { useMemo, useState } from 'react'
import { History, Pencil, Search, UserPlus, Users } from 'lucide-react'
import { DriverHistory } from '../components/DriverHistory.jsx'
import { EmptyState, PageHeader, Table, td, th } from '../components/Layout.jsx'
import { cn } from '../lib/cn.js'
import { useToast } from '../lib/contexts.js'
import { Badge, Button, Card, Dialog, Field, Input, Switch } from '../components/ui.jsx'
import { api } from '../lib/api.js'

const ORDINALS = ['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve',
  'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen', 'Twenty']

/** Defaults copied from the existing phones, so a new hire only needs the unique details. */
function newDriver(drivers) {
  const n = drivers.filter((d) => (Number(d.sort) || 0) < 100).length + 1
  return {
    label: `Driver ${ORDINALS[n - 1] || n}`,
    user: '', surname: 'Sheehan', email: '', birthday: '', recoveryEmail: 'it@sheehan.com.ph',
    brand: 'Samsung', model: 'Galaxy A07', color: 'Black', serial: '', sim: '', active: true,
  }
}

export function Drivers({ data, onChanged }) {
  const { drivers, checks } = data
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState(null) // driver object (no id = new)
  const [historyFor, setHistoryFor] = useState(null)

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return drivers
    return drivers.filter((d) => [d.label, d.user, d.email, d.sim, d.serial].some((v) => String(v || '').toLowerCase().includes(q)))
  }, [drivers, query])

  return (
    <div className="grid grid-cols-1 gap-6">
      <PageHeader
        title="Drivers & phones"
        description="Each row is one company phone and the driver it's assigned to. New hires added here appear in the next load check."
        actions={
          <Button onClick={() => setEditing(newDriver(drivers))}>
            <UserPlus aria-hidden="true" /> Add driver
          </Button>
        }
      />

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
          <div className="relative w-full sm:max-w-xs">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              type="search"
              aria-label="Search drivers"
              placeholder="Search name, email, SIM…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <p className="text-sm text-muted-foreground tabular-nums">
            {drivers.filter((d) => d.active).length} in load checks · {drivers.length} total
          </p>
        </div>

        {shown.length === 0 ? (
          <div className="px-5 pb-5">
            <EmptyState icon={Users} title="No matching drivers" description={`Nothing matches “${query}”. Try a name, email or SIM number.`} />
          </div>
        ) : (
          <Table className="border-t">
            <thead className="bg-muted/40">
              <tr className="border-b">
                <th className={th}>Account</th>
                <th className={th}>Assigned driver</th>
                <th className={th}>Driver email</th>
                <th className={th}>Phone</th>
                <th className={th}>Serial #</th>
                <th className={th}>GOMO SIM #</th>
                <th className={th}>Load checks</th>
                <th className={cn(th, 'text-right')}><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {shown.map((d) => (
                <tr key={d.id} className={cn('transition-colors hover:bg-muted/40', !d.active && 'text-muted-foreground')}>
                  <td className={cn(td, 'font-medium whitespace-nowrap')}>{d.label}</td>
                  <td className={td}>
                    <div className="max-w-60 truncate" title={d.user}>{d.user}</div>
                    {d.surname && d.surname !== 'N/A' && <div className="text-xs text-muted-foreground">Surname: {d.surname}</div>}
                  </td>
                  <td className={cn(td, 'max-w-64')}>
                    <span className="block truncate text-[13px]" title={d.email}>{d.email || '—'}</span>
                  </td>
                  <td className={cn(td, 'whitespace-nowrap text-[13px]')}>
                    {[d.brand, d.model].filter(Boolean).join(' ') || '—'}
                    {d.color && <div className="text-xs text-muted-foreground">{d.color}</div>}
                  </td>
                  <td className={cn(td, 'font-mono text-[13px]')}>{d.serial || '—'}</td>
                  <td className={cn(td, 'font-mono text-[13px] tabular-nums')}>{d.sim || '—'}</td>
                  <td className={td}>{d.active ? <Badge variant="success">Included</Badge> : <Badge variant="muted">Not tracked</Badge>}</td>
                  <td className={cn(td, 'text-right whitespace-nowrap')}>
                    <Button variant="ghost" size="icon-sm" onClick={() => setHistoryFor(d)} aria-label={`History for ${d.label}`} title="History">
                      <History />
                    </Button>
                    <Button variant="ghost" size="icon-sm" onClick={() => setEditing(d)} aria-label={`Edit ${d.label}`} title="Edit">
                      <Pencil />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <p className="text-xs text-muted-foreground">
        Account and Messenger passwords and GOMO app PINs are not stored here: anyone who can open this web app can read what
        it stores. Keep those in the restricted sheet or a password manager.
      </p>

      {editing && (
        <DriverDialog
          key={editing.id || 'new'}
          driver={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null)
            await onChanged()
          }}
          onConflict={async () => {
            // Someone else edited this driver: close, reload, and let the user reopen the new version.
            setEditing(null)
            await onChanged()
          }}
        />
      )}
      <DriverHistory driver={historyFor} checks={checks} onClose={() => setHistoryFor(null)} />
    </div>
  )
}

function DriverDialog({ driver, onClose, onSaved, onConflict }) {
  const isNew = !driver.id
  const toast = useToast()
  const [form, setForm] = useState(driver)
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const validate = (f) => {
    const errs = {}
    if (!f.label.trim()) errs.label = 'Enter an account name, like “Driver Nine”.'
    if (!f.user.trim()) errs.user = 'Enter the assigned driver’s full name.'
    if (f.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) errs.email = 'This doesn’t look like an email address.'
    if (f.recoveryEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.recoveryEmail.trim())) errs.recoveryEmail = 'This doesn’t look like an email address.'
    if (f.sim && !/^0\d{10}$/.test(f.sim.replace(/[\s-]/g, ''))) errs.sim = 'Use the 11-digit number, e.g. 09761500060.'
    return errs
  }
  const blur = (k) => () => setErrors((e) => ({ ...e, [k]: validate(form)[k] }))

  const submit = async (e) => {
    e.preventDefault()
    const errs = validate(form)
    setErrors(errs)
    const first = Object.keys(errs)[0]
    if (first) {
      document.getElementById(`drv-${first}`)?.focus()
      return
    }
    setSaving(true)
    try {
      const { version, ...fields } = form
      const saved = await api.saveDriver(
        { ...fields, user: form.user.trim().toUpperCase(), sim: form.sim.replace(/[\s-]/g, '') },
        isNew ? null : (version ?? null),
      )
      toast(isNew ? `${saved.label} added. They’ll appear in the next load check.` : `${saved.label} updated.`)
      await onSaved()
    } catch (err) {
      setSaving(false)
      if (err.conflict) {
        toast(`${err.message.replace(/ Reload to see the latest data\.$/, '')} Their version is loaded now. Open it again to make your changes.`, { type: 'error', duration: 8000 })
        await onConflict()
      } else {
        toast(err.message, { type: 'error' })
      }
    }
  }

  const text = (key, label, props = {}) => (
    <Field id={`drv-${key}`} label={label} error={errors[key]} required={props.required} hint={props.hint} className={props.className}>
      {(p) => (
        <Input
          {...p}
          type={props.type || 'text'}
          value={form[key] || ''}
          onChange={set(key)}
          onBlur={blur(key)}
          placeholder={props.placeholder}
          inputMode={props.inputMode}
          autoComplete="off"
          className={props.mono ? 'font-mono' : undefined}
        />
      )}
    </Field>
  )

  return (
    <Dialog
      open
      onClose={onClose}
      busy={saving}
      title={isNew ? 'Add driver' : `Edit ${driver.label}`}
      description={isNew ? 'Register a newly hired driver and the phone assigned to them.' : 'Changes apply to future load checks; past checks keep their records.'}
      className="max-w-2xl"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button type="submit" form="driver-form" loading={saving}>
            {isNew ? <><UserPlus aria-hidden="true" /> Add driver</> : 'Save changes'}
          </Button>
        </>
      }
    >
      <form id="driver-form" onSubmit={submit} noValidate className="grid grid-cols-1 gap-6">
        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="mb-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">Driver</legend>
          {text('label', 'Account name', { required: true, placeholder: 'Driver Nine', hint: 'Name used on the load sheet.' })}
          {text('user', 'Assigned driver', { required: true, placeholder: 'SURNAME, FIRST MIDDLE', hint: 'Saved in capital letters.' })}
          {text('surname', 'Surname (account)', { placeholder: 'Sheehan' })}
          {text('birthday', 'Birthday (account)', { type: 'date' })}
        </fieldset>

        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="mb-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">Login</legend>
          {text('email', 'Driver email', { type: 'email', placeholder: 'sheehan.drivernine.loading@gmail.com' })}
          {text('recoveryEmail', 'Recovery email', { type: 'email', placeholder: 'it@sheehan.com.ph' })}
        </fieldset>

        <fieldset className="grid gap-4 sm:grid-cols-3">
          <legend className="mb-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">Phone</legend>
          {text('brand', 'Brand', { placeholder: 'Samsung' })}
          {text('model', 'Model', { placeholder: 'Galaxy A07' })}
          {text('color', 'Color', { placeholder: 'Black' })}
          {text('serial', 'Serial #', { mono: true, placeholder: 'R83L…', className: 'sm:col-span-1' })}
          {text('sim', 'GOMO SIM #', { mono: true, inputMode: 'tel', placeholder: '09XXXXXXXXX', className: 'sm:col-span-2' })}
        </fieldset>

        <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
          <div className="grid gap-1">
            <span id="drv-active-label" className="text-sm font-medium">Include in load checks</span>
            <span className="text-xs text-muted-foreground">Turn off for phones that are retired or not assigned.</span>
          </div>
          <Switch aria-labelledby="drv-active-label" checked={!!form.active} onCheckedChange={(v) => setForm((f) => ({ ...f, active: v }))} />
        </div>
      </form>
    </Dialog>
  )
}
