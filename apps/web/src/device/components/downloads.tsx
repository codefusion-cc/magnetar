import type { DownloadDto, DownloadStatus } from '@magnetar/protocol'
import { memo, useRef, useState, type CSSProperties } from 'react'
import { useFormatDate, useLanguage, useT } from '../../lib/i18n.tsx'
import { downloadBytes, downloadEta, downloadDay } from '../../lib/downloadPresentation.ts'
import { ConfirmDialog } from '../../ui/Modal.tsx'
import { useConnection } from '../DeviceContext.tsx'
import { useRun } from '../useRun.ts'

const STATUS: Record<DownloadStatus, string> = {
  Queued: 'status.queued', FetchingMetadata: 'status.fetchingMetadata', Downloading: 'status.downloading',
  Seeding: 'status.seeding', Paused: 'status.paused', Completed: 'status.completed', Error: 'status.error',
}

export function isActive(d: DownloadDto): boolean {
  return ['Downloading', 'FetchingMetadata', 'Queued', 'Seeding'].includes(d.status)
}
export function isFinished(d: DownloadDto): boolean { return d.status === 'Completed' || d.status === 'Seeding' }
export const ratioOf = (d: DownloadDto) => (d.totalBytes > 0 ? d.uploadedBytes / d.totalBytes : 0)

/** One element for the lane; the canvas slice can read the same progress and status. */
export function ProgressBar({ download: d }: { download: DownloadDto }) {
  const progress = Math.min(100, Math.max(0, d.progress))
  return <div className="download-lane" data-status={d.status} style={{ '--progress': `${progress}%` } as CSSProperties}
    role="progressbar" aria-label={d.name} aria-valuemin={0} aria-valuemax={100}
    aria-valuenow={d.status === 'FetchingMetadata' ? undefined : progress} />
}

export function DownloadFacts({ download: d, down, up, eta }: { download: DownloadDto; down: number; up: number; eta: number | null }) {
  const t = useT()
  const language = useLanguage()
  const date = useFormatDate()
  const bytes = (n: number) => downloadBytes(n, language)
  const done = isFinished(d)
  return <div className="download-meta">
    <span className="download-status" data-status={d.status}>{d.status === 'Error' ? (d.error === 'No peers after 3 minutes' ? t('downloads.noPeers') : d.error || t(STATUS.Error)) : t(STATUS[d.status])}</span>
    {(d.status === 'Downloading' || d.status === 'Paused') && <span>{new Intl.NumberFormat(language, { maximumFractionDigits: 1 }).format(d.progress)}%</span>}
    {d.totalBytes > 0 && <span>{done ? bytes(d.totalBytes) : t('downloads.sizeOf', bytes(d.totalBytes * d.progress / 100), bytes(d.totalBytes))}</span>}
    {down > 0 && <span>{bytes(down)}/s</span>}
    {up > 0 && <span>{t('details.uploaded')} {bytes(up)}/s</span>}
    {eta !== null && <span>{downloadEta(t, eta)}</span>}
    {done && d.completedAt && <span title={date(d.completedAt, true)}>{downloadDay(t, language, d.completedAt)}</span>}
    {d.status === 'Seeding' && d.uploadedBytes > 0 && <span>{t('downloads.ratio', ratioOf(d).toFixed(2))}</span>}
    {d.partialFiles && <span>{t('downloads.someFiles', d.partialFiles.selected, d.partialFiles.total)}</span>}
  </div>
}

/** Unchanged row objects and scalar speeds let memo skip rows untouched by a push. */
export const DownloadRow = memo(function DownloadRow({ download, down, up, eta, seriesName, onOpen }: {
  download: DownloadDto; down: number; up: number; eta: number | null; seriesName?: string; onOpen: (id: number) => void
}) {
  return <li className="download-row" data-download-id={download.id}>
    <h2><button type="button" className="break-release" onClick={() => onOpen(download.id)}>{download.name}</button></h2>
    {seriesName && <p className="muted text-xs">{seriesName}</p>}
    <ProgressBar download={download} />
    <DownloadFacts download={download} down={down} up={up} eta={eta} />
    <DownloadActions download={download} onPlay={onOpen} />
  </li>
})

/** Pending calls lock synchronously, including clicks before React paints the disabled state. */
export function DownloadActions({ download, onPlay, remove = true }: { download: DownloadDto; onPlay?: (id: number) => void; remove?: boolean }) {
  const t = useT()
  const connection = useConnection()
  const run = useRun()
  const lock = useRef(false)
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const primary = isActive(download) ? { label: t('common.pause'), method: 'downloads.pause' as const }
    : download.status === 'Paused' ? { label: t('common.resume'), method: 'downloads.resume' as const }
    : download.status === 'Error' ? { label: t('downloads.tryAgain'), method: 'downloads.resume' as const } : null
  const act = async (action: () => Promise<unknown>) => {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    try { await run(action) } finally { lock.current = false; setBusy(false) }
  }
  return <div className="download-actions">
    {primary && <button type="button" className="infall-small" disabled={busy} aria-busy={busy}
      onClick={() => void act(() => connection.call(primary.method, { id: download.id }))}>{primary.label}</button>}
    {!primary && onPlay && <button type="button" className="infall-small" onClick={() => onPlay(download.id)}>{t('details.play')}</button>}
    {remove && <button type="button" className="infall-small" disabled={busy} onClick={() => setConfirming(true)}>{t('downloads.remove')}</button>}
    {confirming && <ConfirmDialog open title={t('downloads.deleteTitle')} message={t('downloads.deleteMessage', download.name)}
      options={[{ label: t('common.cancel'), value: null, tone: 'ghost' }, { label: t('downloads.keepFiles'), value: false, tone: 'primary' }, { label: t('downloads.deleteFiles'), value: true, tone: 'error' }]}
      onResult={deleteFiles => { setConfirming(false); if (deleteFiles !== null) void act(() => connection.call('downloads.delete', { id: download.id, deleteFiles })) }} />}
  </div>
}

DownloadRow.displayName = 'DownloadRow'
