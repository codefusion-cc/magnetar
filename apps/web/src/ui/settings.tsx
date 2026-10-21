import { useId, type ReactNode } from 'react'

/**
 * One setting as drawn: a heading, what changes it, and a quiet line under it. `alert` is the line that says a change
 * did not save; it replaces nothing, so the setting stays where it was and the reason sits right under it.
 */
export function SettingSection({ title, htmlFor, hint, alert, children, className = '' }: {
  title?: ReactNode
  /** The control the heading names, when it is a single field. */
  htmlFor?: string
  hint?: ReactNode
  alert?: ReactNode
  children?: ReactNode
  className?: string
}) {
  return (
    <section className={`setting ${className}`}>
      {title && <h2>{htmlFor ? <label htmlFor={htmlFor}>{title}</label> : title}</h2>}
      {children}
      {alert && <p className="setting-alert" role="alert">{alert}</p>}
      {hint && <p className="fine">{hint}</p>}
    </section>
  )
}

/** A choice that is on or off, with its words beside the box and an optional quiet line under it. */
export function Check({ label, checked, onChange, disabled = false, hint }: {
  label: ReactNode
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  hint?: ReactNode
}) {
  const id = useId()
  return (
    <>
      <label className="setting-check" htmlFor={id}>
        <input id={id} type="checkbox" checked={checked} disabled={disabled} onChange={e => onChange(e.target.checked)} />
        <span>{label}</span>
      </label>
      {hint && <p className="fine">{hint}</p>}
    </>
  )
}

/** A value shown as text, such as a path or an address, that reads as one unit. */
export function SettingValue({ children }: { children: ReactNode }) {
  return <p className="setting-value">{children}</p>
}

/** Buttons of a setting, in a row that wraps. */
export function SettingActions({ children }: { children: ReactNode }) {
  return <p className="setting-actions">{children}</p>
}
