import { buttonClass } from '@codefusion-cc/ui/react'
import { X } from 'lucide-react'
import { useEffect, useId, useRef, type PointerEvent, type ReactNode, type SyntheticEvent } from 'react'
import { useT } from '../lib/i18n.tsx'

/**
 * A native <dialog>: focus trapping, Escape and the backdrop come from the browser; a press that starts and ends on
 * the backdrop closes it. A sheet from the bottom on a phone, in the middle on a wider screen. The browser focuses the
 * first focusable element (the close button); mark a field `data-autofocus` to start there instead.
 */
export function Modal({ open, title, onClose, children, actions, wide = false }: {
  open: boolean
  title: ReactNode
  onClose: () => void
  children: ReactNode
  actions?: ReactNode
  wide?: boolean
}) {
  const t = useT()
  const ref = useRef<HTMLDialogElement>(null)
  // The visible title names the dialog for screen readers.
  const titleId = useId()
  // The browser fires "close" later, as a task: one this component caused must not close a dialog
  // that has opened again in the meantime.
  const closingItself = useRef(false)
  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) {
      dialog.showModal()
      dialog.querySelector<HTMLElement>('[data-autofocus]')?.focus()
    }
    if (!open && dialog.open) {
      closingItself.current = true
      dialog.close()
    }
  }, [open])
  // React passes a "close" up the component tree, so a dialog inside this one closing is not this one closing.
  const closed = (event: SyntheticEvent<HTMLDialogElement>) => {
    if (event.target !== event.currentTarget) return
    if (closingItself.current) closingItself.current = false
    else onClose()
  }
  // Escape says so at once, in "cancel": an answer that arrives before the later "close" task must already find the
  // dialog closed (a link minted for a dialog closed meanwhile is revoked, not shown). The "close" that follows is ours.
  const cancelled = (event: SyntheticEvent<HTMLDialogElement>) => {
    if (event.target !== event.currentTarget) return
    closingItself.current = true
    onClose()
  }
  // The box fills the dialog, so only the backdrop is the dialog itself. A drag that starts in a field and ends outside
  // is a selection, not a close.
  const pressedOutside = useRef(false)
  const pressed = (event: PointerEvent<HTMLDialogElement>) => { pressedOutside.current = event.target === event.currentTarget }
  const clicked = (event: SyntheticEvent<HTMLDialogElement>) => {
    if (event.target === event.currentTarget && pressedOutside.current) onClose()
    pressedOutside.current = false
  }

  return (
    <dialog ref={ref} className={`infall-dialog${wide ? ' wide' : ''}`} aria-labelledby={titleId} onCancel={cancelled} onClose={closed}
      onPointerDown={pressed} onClick={clicked}>
      {open && <>
        <div className="infall-dialog-head">
          <h3 id={titleId} className="break-release min-w-0 flex-1">{title}</h3>
          <button type="button" className={buttonClass({ tone: 'ghost', size: 'icon' })} aria-label={t('common.close')} onClick={onClose}><X size={18} aria-hidden /></button>
        </div>
        <div className="infall-dialog-body">{children}</div>
        {actions && <div className="infall-dialog-acts">{actions}</div>}
      </>}
    </dialog>
  )
}

export interface ConfirmOption<T> {
  label: string
  value: T
  tone?: 'primary' | 'error' | 'ghost'
}

/** A question with a few answers; resolves with the chosen value, or null when dismissed. */
export function ConfirmDialog<T>({ open, title, message, options, onResult }: {
  open: boolean
  title: string
  message: ReactNode
  options: ConfirmOption<T>[]
  onResult: (value: T | null) => void
}) {
  return (
    <Modal open={open} title={title} onClose={() => onResult(null)}
      actions={options.map(option => (
        <button key={option.label} type="button"
          className={option.tone === 'error' ? 'infall-small danger' : option.tone === 'ghost' ? 'infall-button quiet' : 'infall-button'}
          onClick={() => onResult(option.value)}>
          {option.label}
        </button>
      ))}>
      <p className="break-release">{message}</p>
    </Modal>
  )
}
