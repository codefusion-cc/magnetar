import type { KeyboardEvent, ReactNode } from 'react'
import { nextFocusIndex } from './Menu.tsx'

export interface SegmentOption<T extends string> {
  value: T
  label: string
  icon?: ReactNode
  count?: number
}

/** A small set of mutually exclusive choices, all visible at once (filters, modes). */
export function Segmented<T extends string>({ label, value, options, onChange, size = 'sm', appearance = 'default' }: {
  label: string
  value: T
  options: SegmentOption<T>[]
  onChange: (value: T) => void
  size?: 'xs' | 'sm'
  appearance?: 'default' | 'quiet'
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
    onChange(options[next]!.value)
    buttons[next]?.focus()
  }
  return (
    <div role="radiogroup" aria-label={label} className={appearance === 'quiet' ? 'download-views' : 'scroll-strip strip-bleed flex gap-1 overflow-x-auto'} onKeyDown={navigate}>
      {options.map((option, index) => {
        const selected = option.value === value
        return (
          <button key={option.value} type="button" role="radio" aria-checked={selected} tabIndex={index === tabStop ? 0 : -1} onClick={() => onChange(option.value)}
            className={appearance === 'quiet' ? undefined : `btn btn-${size} shrink-0 gap-1.5 rounded-full font-medium ${selected ? 'btn-neutral' : 'btn-ghost muted border-base-300 bg-base-100'}`}>
            {option.icon}
            {option.label}
            {option.count !== undefined && <span className={`tabular-nums ${selected ? 'opacity-70' : 'opacity-60'}`}>{option.count}</span>}
          </button>
        )
      })}
    </div>
  )
}

export function Switch({ label, checked, onChange, disabled = false, id, tone = 'primary' }: {
  label: string
  checked: boolean
  onChange: (value: boolean) => void
  disabled?: boolean
  id?: string
  /** Warning for a switch that lowers a safeguard. */
  tone?: 'primary' | 'warning'
}) {
  return (
    <input id={id} type="checkbox" role="switch" className={tone === 'warning' ? 'toggle toggle-warning' : 'toggle toggle-primary'} aria-label={label} checked={checked}
      disabled={disabled} onChange={e => onChange(e.target.checked)} />
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
