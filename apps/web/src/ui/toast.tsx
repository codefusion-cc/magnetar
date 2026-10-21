import { CircleAlert, CircleCheck, Info, X } from 'lucide-react'
import { buttonClass } from '@codefusion-cc/ui/react'
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { useT } from '../lib/i18n.tsx'

type Tone = 'success' | 'error' | 'info'

/** A follow-up the toast offers, such as "View downloads". */
export interface ToastAction {
  label: string
  onClick: () => void
}

interface Toast {
  id: number
  tone: Tone
  message: string
  action?: ToastAction
}

type Show = (message: string, tone?: Tone, action?: ToastAction) => void

const ToastContext = createContext<Show>(() => {})

let nextId = 1

export function ToastProvider({ children }: { children: ReactNode }) {
  const t = useT()
  const [toasts, setToasts] = useState<Toast[]>([])
  const dismiss = useCallback((id: number) => setToasts(list => list.filter(item => item.id !== id)), [])
  const show = useCallback<Show>((message, tone = 'info', action) => {
    const id = nextId++
    setToasts(list => [...list.slice(-2), { id, tone, message, action }])
    setTimeout(() => dismiss(id), tone === 'error' ? 8000 : action ? 6000 : 4000)
  }, [dismiss])
  const value = useMemo(() => show, [show])
  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* Above the phone tab bar; bottom right on wide screens. */}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map(toast => (
          <div key={toast.id} className="toast-item">
            {toast.tone === 'success' ? <CircleCheck size={18} className="text-ok" aria-hidden />
              : toast.tone === 'error' ? <CircleAlert size={18} className="text-danger" aria-hidden />
              : <Info size={18} className="text-info" aria-hidden />}
            <span className="break-release min-w-0 flex-1">{toast.message}</span>
            {toast.action && (
              <button type="button" className="setting-link"
                onClick={() => { toast.action!.onClick(); dismiss(toast.id) }}>{toast.action.label}</button>
            )}
            <button type="button" className={buttonClass({ tone: 'ghost', size: 'icon' })} aria-label={t('common.close')} onClick={() => dismiss(toast.id)}>
              <X size={16} aria-hidden />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  return useContext(ToastContext)
}

/** Copies text and confirms with a toast; a blocked clipboard fails quietly, the text stays selectable. */
export function useCopy(message: string) {
  const toast = useToast()
  return useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast(message, 'success')
    } catch {
      // Clipboard access denied.
    }
  }, [toast, message])
}
