import type { KeyboardEvent, ReactNode } from 'react'
import { nextFocusIndex } from './Menu.tsx'

export interface SegmentOption<T extends string> {
  value: T
  label: string
}

/** A small set of mutually exclusive choices, all visible at once (filters, modes): the chosen one raised. */
export function Segmented<T extends string>({ label, value, options, onChange }: {
  label: string
  value: T
  options: SegmentOption<T>[]
  /** `from` is the option's button, for a change that answers where it was made. */
  onChange: (value: T, from: HTMLButtonElement) => void
}) {
  const tabStop = Math.max(0, options.findIndex(option => option.value === value))
  const navigate = (event: KeyboardEvent<HTMLDivElement>) => {
    if (options.length === 0) return
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]')]
    const current = buttons.indexOf(event.target as HTMLButtonElement)
    if (current < 0) return
    const next = nextFocusIndex(event.key, current, options.length)
    if (next === null) return
    event.preventDefault()
    onChange(options[next]!.value, buttons[next]!)
    buttons[next]!.focus()
  }
  return (
    <div role="radiogroup" aria-label={label} className="download-views" onKeyDown={navigate}>
      {options.map((option, index) => {
        const selected = option.value === value
        return (
          <button key={option.value} type="button" role="radio" aria-checked={selected} tabIndex={index === tabStop ? 0 : -1} onClick={event => onChange(option.value, event.currentTarget)}>
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

/** Something that runs or rests (a series, a watch), switched at once, with its name beside it. */
export function Switch({ label, checked, onChange, disabled = false }: {
  label: string
  checked: boolean
  onChange: (value: boolean) => void
  disabled?: boolean
}) {
  return (
    <label className="setting-check">
      <input type="checkbox" role="switch" className="infall-switch" checked={checked} disabled={disabled} onChange={e => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  )
}

/** Page title, an optional one-line summary under it, and the page's main action on the right. */
export function PageHeader({ title, summary, action }: { title: string; summary?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end gap-x-4 gap-y-3 sm:mb-6">
      {/* Never narrower than the title's longest word: the action moves under it instead of over it. */}
      <div className="min-w-min max-w-full flex-1">
        <h1 className="text-[23px] leading-tight break-words sm:text-[28px]">{title}</h1>
        {summary && <div className="muted mt-1 text-sm">{summary}</div>}
      </div>
      {action}
    </div>
  )
}
