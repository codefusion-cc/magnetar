import type { LegacyImportStatusDto } from '@magnetar/protocol'
import { useEffect, useState } from 'react'
import { useT } from '../../lib/i18n.tsx'
import { useToast } from '../../ui/toast.tsx'
import { useDevice } from '../DeviceContext.tsx'
import { useRun } from '../useRun.ts'

const DISMISSED = 'magnetar-import-dismissed'

/** Whether a MediaDownloader 1.x database is there to import, and the import itself. */
export function useLegacyImport() {
  const t = useT()
  const toast = useToast()
  const run = useRun()
  const { connection, connectionState } = useDevice()
  const [status, setStatus] = useState<LegacyImportStatusDto | null>(null)
  const [busy, setBusy] = useState(false)
  // Asked once the device answers: a page opened while connecting would otherwise ask too early and never again.
  const open = connectionState.status === 'open'
  useEffect(() => {
    if (open) void connection.call('legacy.status').then(setStatus).catch(() => {})
  }, [connection, open])

  const runImport = async () => {
    setBusy(true)
    const result = await run(() => connection.call('legacy.import'), 'import.failed')
    setBusy(false)
    if (!result) return
    toast(t('import.done', result.downloads, result.seriesTasks), 'success')
    if (result.secretsToReenter.length) toast(t('import.reenter', result.secretsToReenter.join(', ')), 'info')
    setStatus(await connection.call('legacy.status'))
  }
  return { status, busy, runImport }
}

/** Offers the 1.x import where a returning user lands, until it is done or dismissed. */
export function LegacyImportBanner() {
  const t = useT()
  const { status, busy, runImport } = useLegacyImport()
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISSED) === '1'
    } catch {
      return false
    }
  })
  if (!status?.available || status.imported || dismissed) return null
  const dismiss = () => {
    setDismissed(true)
    try {
      localStorage.setItem(DISMISSED, '1')
    } catch {
      // Storage unavailable: it comes back next time, which is harmless.
    }
  }
  return (
    <div className="update-bar">
      <p><b className="font-semibold">{t('import.bannerTitle')}</b> {t('import.hint', status.downloads, status.seriesTasks)}</p>
      <div className="infall-acts">
        <button type="button" className="infall-button quiet sm" onClick={dismiss}>{t('common.notNow')}</button>
        <button type="button" className="infall-button sm" disabled={busy} aria-busy={busy} onClick={() => void runImport()}>{t('import.button')}</button>
      </div>
    </div>
  )
}
