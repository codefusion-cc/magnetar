import type { SettingsDto, TransferStatusDto } from '@magnetar/protocol'
import { HardDrive } from 'lucide-react'
import { useRef, useState } from 'react'
import { Link } from 'react-router'
import { useT } from '../../lib/i18n.tsx'
import { useDevice } from '../DeviceContext.tsx'
import { useToast } from '../../ui/toast.tsx'
import { useRun } from '../useRun.ts'

/** Why nothing is downloading, when the engine isn't running: a missing VPN, a failed start. */
export function TransferNotice({ transfer }: { transfer: TransferStatusDto | null }) {
  const t = useT()
  const { basePath } = useDevice()
  if (!transfer || transfer.engine === 'running' || transfer.engine === 'off') return null
  const waiting = transfer.engine === 'waitingForNetwork'
  const starting = transfer.engine === 'starting'
  return <div role="status" className="download-transfer-notice">
    <p>{waiting ? t('downloads.networkWaiting', transfer.networkInterface ?? '') : t(starting ? 'transfer.starting' : 'transfer.failedText', transfer.message ?? '')}</p>
    {waiting && <Link to={`${basePath}/settings/downloads`} className="infall-small">{t('downloads.networkSettings')}</Link>}
  </div>
}

/**
 * A full disk: what Magnetar writes can't be saved, which no engine state shows. The app logs these errors as warnings
 * rather than reporting them, so this is where the person hears of it, and what to do about it.
 */
export function DiskFullNotice({ transfer }: { transfer: TransferStatusDto | null }) {
  const t = useT()
  const full = transfer?.diskFull
  if (!full) return null
  return (
    <div role="alert" className="surface mb-5 flex items-start gap-3 border-error/40 bg-error/5 p-4">
      <HardDrive size={20} className="mt-0.5 shrink-0 text-error" />
      <div className="min-w-0 flex-1 text-sm">
        <div className="font-semibold">{t('transfer.diskFullTitle')}</div>
        <p className="muted mt-0.5 break-words">{full.drive ? t('transfer.diskFullText', full.drive) : t('transfer.diskFullHere')}</p>
      </div>
    </div>
  )
}

/** The alternative ("slow") limits, switched on and off from the Downloads page. */
export function AltSpeedToggle({ settings, transfer }: { settings: SettingsDto; transfer: TransferStatusDto | null }) {
  const t = useT()
  const run = useRun()
  const toast = useToast()
  const { connection } = useDevice()
  const active = transfer?.altSpeedActive ?? settings.altSpeedMode === 'on'
  const end = `${String(Math.floor(settings.altScheduleTo / 60)).padStart(2, '0')}:${String(settings.altScheduleTo % 60).padStart(2, '0')}`
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  return <span className="speed-control">
    {active && <span>{settings.altSpeedMode === 'scheduled' ? t('transfer.slowUntil', end) : t('transfer.slowed')}</span>}
    <button type="button" disabled={busy} aria-pressed={active} onClick={async () => {
      if (lock.current) return
      lock.current = true
      setBusy(true)
      try {
        const saved = await run(() => connection.call('settings.update', { altSpeedMode: active ? 'off' : 'on' }), 'settings.saveFailed')
        if (saved && settings.altSpeedMode === 'scheduled') toast(t('transfer.scheduleOff'), 'info')
      } finally { lock.current = false; setBusy(false) }
    }}>{t(active ? 'transfer.fullSpeed' : 'transfer.slowDown')}</button>
  </span>
}

