import { useEffect, useId, useState, type InputHTMLAttributes, type ReactNode } from 'react'
import { Copy } from 'lucide-react'
import { Select, type SelectProps } from './Select.tsx'

/** A read-only value with a button that copies it. */
export function CopyInput({ label, value, copyLabel, onCopy, small = false }: {
  label: string
  value: string
  copyLabel: string
  onCopy: (value: string) => void
  small?: boolean
}) {
  return (
    <div className="join w-full">
      <input readOnly aria-label={label} className={`input join-item w-full min-w-0 font-mono ${small ? 'text-xs' : 'text-sm'}`} value={value} />
      <button type="button" className="btn join-item" aria-label={`${copyLabel}: ${label}`} onClick={() => onCopy(value)}><Copy size={16} /></button>
    </div>
  )
}

/**
 * A field with its name above and optional help below; the name stays visible while typing. A single input sits inside
 * the label. A control with a list of its own (a Select) is named with `htmlFor`, and a group of choices that names
 * itself (a Segmented) gets `group`: a label passes a click anywhere in it on to its first control.
 */
export function Field({ label, help, className = '', htmlFor, group = false, children }: {
  label: string; help?: ReactNode; className?: string; htmlFor?: string; group?: boolean; children: ReactNode
}) {
  const Root = htmlFor || group ? 'div' : 'label'
  const Name = htmlFor ? 'label' : 'span'
  return (
    <Root className={`flex flex-col gap-1.5 ${className}`}>
      <Name htmlFor={htmlFor} className="text-sm font-medium">{label}</Name>
      {children}
      {help && <span className="muted text-xs">{help}</span>}
    </Root>
  )
}

/** A labelled choice of one among a few, as wide as its form. */
export function SelectField<T extends string | number>({ label, help, className, ...select }: {
  label: string; help?: ReactNode; className?: string
} & Omit<SelectProps<T>, 'id' | 'label' | 'className'>) {
  const id = useId()
  return (
    <Field label={label} help={help} className={className} htmlFor={id}>
      <Select id={id} className="w-full" {...select} />
    </Field>
  )
}

/** A labelled text input bound to a value. */
export function TextField({ label, help, value, onChange, className, ...rest }: {
  label: string
  help?: ReactNode
  value: string
  onChange: (value: string) => void
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  return (
    <Field label={label} help={help} className={className}>
      <input className="input w-full" value={value} onChange={e => onChange(e.target.value)} {...rest} />
    </Field>
  )
}

/** Enter commits a field the same way leaving it does. */
export const blurOnEnter = (e: React.KeyboardEvent<HTMLInputElement>) => {
  if (e.key === 'Enter') e.currentTarget.blur()
}

/**
 * An input that edits a local draft and saves when it loses focus (or on Enter), only when the
 * value actually changed. The draft follows the value when it changes elsewhere.
 */
export function SaveOnBlurInput({ value, onSave, className = 'input w-full', ...rest }: {
  value: string
  onSave: (value: string) => void
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'onBlur' | 'onKeyDown'>) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  return (
    <input {...rest} className={className} value={draft} onChange={e => setDraft(e.target.value)}
      onBlur={() => draft !== value && onSave(draft)} onKeyDown={blurOnEnter} />
  )
}
