import { useCallback, useRef, useState } from 'react'
import { errorMessage } from '../lib/errors.ts'
import { useT } from '../lib/i18n.tsx'
import { useToast } from '../ui/toast.tsx'

/**
 * Runs a device call and turns a failure into an error toast (optionally formatted with a
 * translated template taking the message as {0}). Resolves undefined when the call failed.
 */
export function useRun() {
  const toast = useToast()
  const t = useT()
  return useCallback(async <T,>(action: () => Promise<T>, errorKey?: string): Promise<T | undefined> => {
    try {
      return await action()
    } catch (error) {
      const message = errorMessage(error)
      toast(errorKey ? t(errorKey, message) : message, 'error')
      return undefined
    }
  }, [toast, t])
}

/** A device action locked until it settles, even before the disabled state paints. */
export function useLockedRun() {
  const perform = useRun()
  const lock = useRef(false)
  const [busy, setBusy] = useState(false)
  const run = useCallback(async <T,>(action: () => Promise<T>, errorKey?: string): Promise<T | undefined> => {
    if (lock.current) return undefined
    lock.current = true
    setBusy(true)
    try { return await perform(action, errorKey) }
    finally { lock.current = false; setBusy(false) }
  }, [perform])
  const isBusy = useCallback(() => lock.current, [])
  return { busy, run, isBusy }
}
