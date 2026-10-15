import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { findTyped, moveActive, typedCharacter } from './selectKeys.ts'

export interface SelectOption<T> { value: T; label: string; /** The label's language, when it is not the page's (a language's own name). */ lang?: string }

/** How long typed letters count as one word when finding an option. */
const TYPING_PAUSE_MS = 600
/** Room the list wants below the button before it opens above it instead: its tallest (max-h-72) and its gap. */
const LIST_ROOM_PX = 296

const LOOKS = {
  field: 'min-h-[46px] w-full min-w-40 rounded-[10px] border border-line bg-surface px-3.5 text-base text-ink',
  small: 'min-h-[38px] max-w-full rounded-[10px] border border-line bg-surface px-2.5 text-[15px] text-ink',
  quiet: 'min-h-[38px] px-1 text-[13px] text-muted hover:text-ink aria-expanded:text-ink',
}

export interface SelectProps<T> {
  value: T
  options: readonly SelectOption<T>[]
  onChange: (value: T) => void
  /** Called as the list opens, to read its options again (the computer's network connections). */
  onOpen?: () => void
  /** Its name, read out; leave it out when a `<label htmlFor={id}>` names it. */
  label?: string
  id?: string
  look?: keyof typeof LOOKS
  disabled?: boolean
  className?: string
}

/**
 * A choice of one among a few, drawn in the look instead of the system's menu: a button showing the choice, and a list
 * under it (above it near the bottom of the screen, toward the middle near a side). It is the ARIA select-only
 * combobox: focus stays on the button; the arrows, Page keys, Home and End move through the list; typing finds an
 * option; Enter, Space or Tab take the one marked; Escape, or the focus leaving it, leaves the choice as it was. It is
 * as wide as its longest word needs; `className="w-full"` stretches it. Closed, Up and Down open the list rather than
 * change the choice, so nothing changes by accident.
 */
export function Select<T extends string | number>({ value, options, onChange, onOpen, label, id, look = 'field', disabled = false, className = '' }: SelectProps<T>) {
  const ownId = useId()
  const buttonId = id ?? `${ownId}-button`
  const listId = `${ownId}-list`
  const [open, setOpen] = useState(false)
  // The marked option, by value: options read again while the list is open keep the mark on the same one.
  const [marked, setMarked] = useState<T | null>(null)
  const [place, setPlace] = useState({ above: false, end: false })
  const button = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const typed = useRef({ text: '', at: 0 })
  // Only the keys scroll the list to the mark: a mark the pointer moves is already under it.
  const byKey = useRef(false)
  // -1 when the value is none of the options (a source since renamed): nothing shows as chosen rather than the first.
  const chosen = options.findIndex(o => Object.is(o.value, value))
  const from = Math.max(0, chosen)
  const markedAt = marked === null ? -1 : options.findIndex(o => Object.is(o.value, marked))
  const active = markedAt >= 0 ? markedAt : from
  const mark = (index: number, key = false) => {
    const option = options[index]
    if (!option) return
    byKey.current = key
    setMarked(option.value)
  }

  const show = (at: number) => {
    if (options.length === 0) return
    mark(at, true)
    // Opens above when the room below is short and there is more above; toward the middle from a side.
    const box = button.current?.getBoundingClientRect()
    if (box) setPlace({ above: innerHeight - box.bottom < LIST_ROOM_PX && box.top > innerHeight - box.bottom, end: box.left + box.width / 2 > innerWidth / 2 })
    setOpen(true)
    onOpen?.()
  }
  const take = (index: number) => {
    setOpen(false)
    const option = options[index]
    if (option && !Object.is(option.value, value)) onChange(option.value)
  }

  useLayoutEffect(() => {
    if (open && byKey.current) list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [open, active])

  const onKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    const now = performance.now()
    const typing = typed.current.text !== '' && now - typed.current.at < TYPING_PAUSE_MS
    const character = typedCharacter(event, typing)
    const find = (start: number) => {
      const text = typing ? typed.current.text + character : character!
      typed.current = { text, at: now }
      // The page's language folds the labels: the closest element that names one.
      const language = button.current?.closest('[lang]')?.getAttribute('lang') ?? undefined
      return findTyped(options.map(o => o.label), text, start, language)
    }
    if (!open) {
      const opensAt = character ? find(from) ?? undefined
        : ({ ArrowDown: from, Enter: from, ' ': from, ArrowUp: Math.max(0, from - 1), Home: 0, End: options.length - 1 } as Partial<Record<string, number>>)[event.key]
      if (character === ' ' || (!character && opensAt !== undefined)) event.preventDefault()
      if (opensAt !== undefined) show(opensAt)
      return
    }
    const moved = moveActive(event.key, active, options.length)
    if ((event.key === 'ArrowUp' && event.altKey) || (!character && ['Enter', ' ', 'Tab'].includes(event.key))) {
      if (event.key !== 'Tab') event.preventDefault()
      take(active)
    } else if (moved !== null) {
      event.preventDefault()
      mark(moved, true)
    } else if (character) {
      event.preventDefault()
      const found = find(active)
      if (found !== null) mark(found, true)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      setOpen(false)
    }
  }

  return (
    <div className={`relative inline-flex min-w-0 max-w-full ${className}`}>
      <button ref={button} id={buttonId} type="button" role="combobox" disabled={disabled}
        aria-haspopup="listbox" aria-expanded={open} aria-controls={listId} aria-label={label}
        aria-activedescendant={open ? `${ownId}-option-${active}` : undefined}
        className={`inline-flex min-w-0 cursor-pointer items-center justify-between gap-2 text-left disabled:cursor-default disabled:opacity-55 ${LOOKS[look]}`}
        onClick={() => (open ? setOpen(false) : show(from))} onKeyDown={onKey} onBlur={() => setOpen(false)}>
        <span className="min-w-0 truncate">{options[chosen]?.label}</span>
        <span aria-hidden="true" className={`size-1.5 shrink-0 border-r-[1.5px] border-b-[1.5px] border-current transition-transform motion-reduce:transition-none ${open ? 'translate-y-0.5 rotate-225' : '-translate-y-0.5 rotate-45'}`} />
      </button>
      {/* A press anywhere in the list (an option, its scrollbar) leaves the focus on the button: leaving it closes the list. */}
      <ul ref={list} id={listId} role="listbox" aria-labelledby={buttonId} hidden={!open} onPointerDown={event => event.preventDefault()}
        className={`absolute z-50 max-h-72 min-w-full max-w-[calc(100vw-2rem)] overflow-y-auto rounded-[10px] border border-line bg-surface p-1 text-[15px] text-ink ${
          place.above ? 'bottom-full mb-1' : 'top-full mt-1'} ${place.end ? 'right-0' : 'left-0'}`}>
        {open && options.map((option, index) => (
          <li key={String(option.value)} id={`${ownId}-option-${index}`} role="option" data-index={index} lang={option.lang}
            aria-selected={index === chosen} data-active={index === active || undefined}
            className="flex min-h-10 cursor-pointer items-center whitespace-nowrap rounded-md px-3 data-active:bg-raised aria-selected:font-semibold"
            onPointerMove={() => { if (index !== active) mark(index) }} onClick={() => take(index)}>
            {option.label}
          </li>
        ))}
      </ul>
    </div>
  )
}
