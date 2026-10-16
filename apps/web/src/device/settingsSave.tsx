import type { SettingsPatch } from '@magnetar/protocol'
import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type InputHTMLAttributes, type ReactNode } from 'react'
import { errorMessage } from '../lib/errors.ts'
import { useT, type Translate } from '../lib/i18n.tsx'
import { RpcError } from '../lib/rpcClient.ts'
import { blurOnEnter } from '../ui/fields.tsx'
import { Check } from '../ui/settings.tsx'
import { useDevice } from './DeviceContext.tsx'

type Field = keyof SettingsPatch
interface Failure { fields: ReadonlySet<Field>; text: string }
interface Saving { save: (patch: SettingsPatch) => Promise<boolean>; failure: Failure | null }

const SaveContext = createContext<Saving | null>(null)

/** Why a change did not save, as the setting says it: the computer did not answer, or what it answered. */
export function notSavedText(t: Translate, deviceName: string, error: unknown): string {
  const unanswered = error instanceof RpcError && (error.code === 'timeout' || error.code === 'offline')
  return unanswered ? t('settings.notSaved', deviceName) : t('settings.notSavedReason', errorMessage(error))
}

/**
 * Settings save themselves, each change on its own. A change the computer did not take leaves the setting as the
 * computer has it (the page shows what `settings.changed` says), and the setting it belongs to says so until it saves.
 */
export function SettingsSaveProvider({ children }: { children: ReactNode }) {
  const t = useT()
  const { connection, deviceName } = useDevice()
  const [failure, setFailure] = useState<Failure | null>(null)
  // One change at a time, in the order they were made: a list saved whole (the sources) must not arrive before
  // the change it builds on, or the computer would keep the older list.
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  const send = useCallback(async (patch: SettingsPatch) => {
    const fields = Object.keys(patch) as Field[]
    try {
      await connection.call('settings.update', patch)
      setFailure(current => current && fields.some(f => current.fields.has(f)) ? null : current)
      return true
    } catch (error) {
      setFailure({ fields: new Set(fields), text: notSavedText(t, deviceName, error) })
      return false
    }
  }, [connection, deviceName, t])
  const save = useCallback((patch: SettingsPatch) => {
    const next = queue.current.then(() => send(patch))
    queue.current = next
    return next
  }, [send])
  const value = useMemo(() => ({ save, failure }), [save, failure])
  return <SaveContext.Provider value={value}>{children}</SaveContext.Provider>
}

/** Saves a change; resolves false when it did not save, after the setting it belongs to has said why. */
export function useSaveSetting(): (patch: SettingsPatch) => Promise<boolean> {
  return useContext(SaveContext)!.save
}

/** What to say under a setting made of these fields when its last change did not save. */
export function useSaveFailure(...fields: Field[]): string | undefined {
  const failure = useContext(SaveContext)!.failure
  return failure && fields.some(f => failure.fields.has(f)) ? failure.text : undefined
}

/**
 * A setting's value as the person just chose it: shown at once, kept until the computer reports it back, and dropped
 * (back to what the computer has) when the change did not save.
 */
export function useChosen<T>(current: T, save: (value: T) => Promise<boolean>, same: (a: T, b: T) => boolean = Object.is): [T, (value: T) => void] {
  const [chosen, setChosen] = useState<{ value: T } | null>(null)
  useEffect(() => { if (chosen && same(chosen.value, current)) setChosen(null) }, [chosen, current, same])
  const choose = useCallback((value: T) => {
    const mine = { value }
    setChosen(mine)
    void save(value).then(saved => {
      if (!saved) return setChosen(now => (now === mine ? null : now))
      // Saved, but the computer may report it a moment later, or spelled its own way (a rounded number): stop waiting.
      setTimeout(() => setChosen(now => (now === mine ? null : now)), 2000)
    })
  }, [save])
  return [chosen ? chosen.value : current, choose]
}

/** A checkbox setting that saves itself, ticks at once, and goes back if the change did not save. */
export function SettingCheck({ label, checked, onSave, disabled, hint }: {
  label: ReactNode
  checked: boolean
  onSave: (checked: boolean) => Promise<boolean>
  disabled?: boolean
  hint?: ReactNode
}) {
  const [shown, choose] = useChosen(checked, onSave)
  return <Check label={label} checked={shown} onChange={choose} disabled={disabled} hint={hint} />
}

/**
 * A typed setting's draft: it follows what the computer has, except while the person is in the field, so a late
 * echo of an earlier save never overwrites what they are typing.
 */
export function useDraft(shown: string): [string, (draft: string) => void, { onFocus: () => void; onBlur: () => void }, () => void] {
  const [draft, setDraft] = useState(shown)
  const editing = useRef(false)
  useEffect(() => { if (!editing.current) setDraft(shown) }, [shown])
  const reset = useCallback(() => setDraft(shown), [shown])
  const focus = useMemo(() => ({ onFocus: () => { editing.current = true }, onBlur: () => { editing.current = false } }), [])
  return [draft, setDraft, focus, reset]
}

/** A labelled text setting saved when it loses focus; a change that did not save goes back to what the computer has. */
export function TextSetting({ label, value, onSave, className = '', ...rest }: {
  label: string
  value: string
  onSave: (value: string) => Promise<boolean> | void
  className?: string
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'onBlur' | 'onKeyDown' | 'id'>) {
  const id = useId()
  const [draft, setDraft, focus, reset] = useDraft(value)
  const commit = async () => {
    focus.onBlur()
    if (draft === value) return
    const saved = await onSave(draft)
    if (saved === false) reset()
  }
  return (
    <div className={`setting-field ${className}`}>
      <label htmlFor={id}>{label}</label>
      <input id={id} {...rest} value={draft} onChange={e => setDraft(e.target.value)} onFocus={focus.onFocus} onBlur={() => void commit()} onKeyDown={blurOnEnter} />
    </div>
  )
}
