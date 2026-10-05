import { Download, FolderOpen } from 'lucide-react'
import { formatBytes } from '@magnetar/protocol/bytes'
import { lazy, Suspense, useEffect, useId, useRef, useState } from 'react'
import { useT } from '../../lib/i18n.tsx'
import { updates } from '../../lib/updates.ts'
import { blurOnEnter } from '../../ui/fields.tsx'
import { Loading } from '../../ui/Loading.tsx'
import { Modal } from '../../ui/Modal.tsx'
import { useDevice } from '../DeviceContext.tsx'

// The browser loads when first opened: most pages with a folder field never open it.
const Chooser = lazy(() => updates.importOrReload(() => import('./folderChooser.tsx')).then(m => ({ default: m.Chooser })))

/**
 * Chooses a folder on the device (not this computer, when used through the relay), inside the folders Files may
 * browse. It opens at `start` when that is inside one of them, else at the list of them.
 */
export function FolderBrowser({ open, start, onClose, onSelect, save }: {
  open: boolean
  start: string
  onClose: () => void
  onSelect: (path: string) => void
  /**
   * Saving a download rather than setting a folder: the button reads "Download here" and starts it, the folders
   * used before are offered to jump to, and a refusal from the device shows in the dialog.
   */
  save?: { recent: string[]; fallback: string; busy: boolean; error: string | null; subject?: { name: string; bytes: number | null } }
}) {
  const t = useT()
  // The folder on screen: null on the list of folders, undefined until the chooser has placed itself.
  const [chosen, setChosen] = useState<string | null | undefined>(undefined)
  const primary = useRef<HTMLButtonElement>(null)
  // The first listing of an opening takes focus to Download here, so Enter saves to the folder it opened in;
  // after that, where the user goes is theirs.
  const focused = useRef(false)
  useEffect(() => {
    if (!open) {
      setChosen(undefined)
      focused.current = false
    }
  }, [open])
  const ready = () => {
    if (focused.current || !save) return
    focused.current = true
    primary.current?.focus()
  }
  return (
    <Modal open={open} title={t(save ? 'dialog.downloadTo' : 'dialog.chooseFolder')} icon={save ? <Download size={20} /> : <FolderOpen size={20} />} onClose={onClose} wide
      actions={<>
        <button type="button" className="btn btn-ghost btn-sm" disabled={save?.busy} onClick={onClose}>{t('common.cancel')}</button>
        <button type="button" ref={primary} className="btn btn-primary btn-sm" disabled={!chosen || save?.busy} onClick={() => chosen && onSelect(chosen)}>
          {save?.busy && <span className="loading loading-spinner loading-xs" />}
          {save && !save.busy && <Download size={14} />}
          {t(save ? 'folderBrowser.downloadHere' : 'folderBrowser.selectFolder')}
        </button>
      </>}>
      {save?.subject && (
        <p className="mb-3 flex items-baseline gap-2 text-sm">
          <span className="min-w-0 flex-1 truncate font-medium" title={save.subject.name}>{save.subject.name}</span>
          {save.subject.bytes !== null && <span className="muted shrink-0 tabular-nums">{formatBytes(save.subject.bytes)}</span>}
        </p>
      )}
      {save?.error && <p role="alert" className="mb-3 whitespace-pre-line text-sm text-error">{save.error}</p>}
      {open && <Suspense fallback={<Loading />}><Chooser start={start} path={chosen} onPath={setChosen} recent={save?.recent} fallback={save?.fallback} needBytes={save?.subject?.bytes} onReady={ready} /></Suspense>}
    </Modal>
  )
}

/**
 * A folder path input with a Browse button: the macOS folder chooser on the device's own
 * dashboard, the in-page browser everywhere else.
 */
export function FolderField({ label, value, placeholder, help, onChange, hideLabel = false }: {
  label: string
  /** When a surrounding setting row already names it. */
  hideLabel?: boolean
  value: string
  placeholder?: string
  help?: string
  onChange: (path: string) => void
}) {
  const t = useT()
  const { connection, info } = useDevice()
  const id = useId()
  const [browsing, setBrowsing] = useState(false)
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])

  const browse = async () => {
    if (info?.nativeFolderPicker) {
      try {
        const { path } = await connection.call('fs.pickNative', { start: draft || placeholder, prompt: t('dialog.chooseDownloadFolder') })
        if (path) onChange(path)
        return
      } catch {
        // Fall back to the in-page browser.
      }
    }
    setBrowsing(true)
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className={hideLabel ? 'sr-only' : 'text-sm font-medium'}>{label}</label>
      <div className="join w-full">
        <input id={id} className="input join-item w-full min-w-0 font-mono text-sm" value={draft} placeholder={placeholder ?? label}
          onChange={e => setDraft(e.target.value)} onBlur={() => draft !== value && onChange(draft)}
          onKeyDown={blurOnEnter} />
        <button type="button" className="btn join-item" aria-label={t('common.browse')} onClick={() => void browse()}><FolderOpen size={16} /><span className="hidden sm:inline">{t('common.browse')}</span></button>
      </div>
      {help && <p className="muted text-xs">{help}</p>}
      <FolderBrowser open={browsing} start={draft || placeholder || ''} onClose={() => setBrowsing(false)}
        onSelect={path => { setBrowsing(false); setDraft(path); onChange(path) }} />
    </div>
  )
}
