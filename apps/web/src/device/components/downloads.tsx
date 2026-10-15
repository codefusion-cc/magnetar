import type { DownloadDto, DownloadStatus } from '@magnetar/protocol'
import { Component, createRef, memo, useState, type ReactNode } from 'react'
import { formatters, useFormatBytes, useFormatRate, useFormatEta, useFormatDate, useLanguage, useT } from '../../lib/i18n.tsx'
import { isActive, isFinished } from '../../lib/downloadViews.ts'
import { downloadDay, noPeersError } from '../../lib/downloadPresentation.ts'
import { ConfirmDialog } from '../../ui/Modal.tsx'
import { useConnection } from '../DeviceContext.tsx'
import { useLockedRun } from '../useRun.ts'

const STATUS: Record<DownloadStatus, string> = {
  Queued: 'status.queued', FetchingMetadata: 'status.fetchingMetadata', Downloading: 'status.downloading',
  Seeding: 'status.seeding', Paused: 'status.paused', Completed: 'status.completed', Error: 'status.error',
}

export const ratioOf = (d: DownloadDto) => (d.totalBytes > 0 ? d.uploadedBytes / d.totalBytes : 0)

/** The accessible progress and geometry used by the containing scene. */
export function ProgressBar({ download: d }: { download: DownloadDto }) {
  const progress = Math.min(100, Math.max(0, d.progress))
  return <div className="download-lane" data-status={d.status} data-progress={progress}
    role="progressbar" aria-label={d.name} aria-valuemin={0} aria-valuemax={100}
    aria-valuenow={d.status === 'FetchingMetadata' ? undefined : progress} />
}

export function DownloadFacts({ download: d, down, up, eta }: { download: DownloadDto; down: number; up: number; eta: number | null }) {
  const t = useT()
  const language = useLanguage()
  const date = useFormatDate()
  const bytes = useFormatBytes()
  const rate = useFormatRate()
  const etaText = useFormatEta()
  const done = isFinished(d)
  return <div className="download-meta">
    <span className="download-status" data-status={d.status}>{d.status === 'Error' ? (noPeersError(d.error) ? t('downloads.noPeers') : d.error || t(STATUS.Error)) : t(STATUS[d.status])}</span>
    {(d.status === 'Downloading' || d.status === 'Paused') && <span>{formatters(language).number(d.progress, { maximumFractionDigits: 1 })}%</span>}
    {d.totalBytes > 0 && <span>{done ? bytes(d.totalBytes) : t('downloads.sizeOf', bytes(d.totalBytes * d.progress / 100), bytes(d.totalBytes))}</span>}
    {down > 0 && <span>{rate(down)}</span>}
    {up > 0 && <span>{t('details.uploaded')} {rate(up)}</span>}
    {eta !== null && <span>{etaText(eta)}</span>}
    {isActive(d) && d.peers > 0 && <span>{t('downloads.peers', d.peers)}</span>}
    {done && d.completedAt && <span title={date(d.completedAt, true)}>{downloadDay(language, d.completedAt)}</span>}
    {d.status === 'Seeding' && d.uploadedBytes > 0 && <span>{t('downloads.ratio', ratioOf(d).toFixed(2))}</span>}
    {d.partialFiles && <span>{t('downloads.someFiles', d.partialFiles.selected, d.partialFiles.total)}</span>}
  </div>
}

/** Unchanged row objects and scalar speeds let memo skip rows untouched by a push. */
export const DownloadRow = memo(function DownloadRow({ download, down, up, eta, seriesName, onOpen }: {
  download: DownloadDto; down: number; up: number; eta: number | null; seriesName?: string; onOpen: (id: number) => void
}) {
  return <DownloadItem download={download}>
    <h2><button type="button" className="break-release" onClick={() => onOpen(download.id)}>{download.name}</button></h2>
    {seriesName && <p className="muted text-xs">{seriesName}</p>}
    <ProgressBar download={download} />
    <DownloadFacts download={download} down={down} up={up} eta={eta} />
    <DownloadActions download={download} onPlay={onOpen} />
  </DownloadItem>
})

/** Capture the old height before the facts shorten, including after a viewport resize. */
class DownloadItem extends Component<{ download: DownloadDto; children: ReactNode }> {
  private element = createRef<HTMLLIElement>()

  override getSnapshotBeforeUpdate(previous: Readonly<{ download: DownloadDto }>): number | null {
    return !isFinished(previous.download) && isFinished(this.props.download)
      ? this.element.current?.getBoundingClientRect().height ?? null : null
  }

  override componentDidUpdate(_previous: unknown, _state: unknown, height: number | null) {
    const element = this.element.current
    if (!element) return
    if (height !== null) element.style.minHeight = `${height}px`
    else if (!isFinished(this.props.download)) element.style.removeProperty('min-height')
  }

  override render() {
    return <li ref={this.element} className="download-row" data-download-id={this.props.download.id}>{this.props.children}</li>
  }
}

/** Pending calls lock synchronously, including clicks before React paints the disabled state. */
export function DownloadActions({ download, onPlay, remove = true, between, prominent = false }: { download: DownloadDto; onPlay?: (id: number) => void; remove?: boolean; between?: ReactNode; prominent?: boolean }) {
  const t = useT()
  const connection = useConnection()
  const { busy, run: act } = useLockedRun()
  const [confirming, setConfirming] = useState(false)
  const primary = isActive(download) ? { label: t('common.pause'), method: 'downloads.pause' as const }
    : download.status === 'Paused' ? { label: t('common.resume'), method: 'downloads.resume' as const }
    : download.status === 'Error' ? { label: t('downloads.tryAgain'), method: 'downloads.resume' as const } : null
  return <div className="download-actions">
    {primary && <button type="button" className={prominent ? 'infall-button' : 'infall-small'} disabled={busy} aria-busy={busy}
      onClick={() => void act(() => connection.call(primary.method, { id: download.id }))}>{primary.label}</button>}
    {!primary && onPlay && <button type="button" className="infall-small" onClick={() => onPlay(download.id)}>{t('details.play')}</button>}
    {between}
    {remove && <button type="button" className="infall-small" disabled={busy} onClick={() => setConfirming(true)}>{t('downloads.remove')}</button>}
    {confirming && <ConfirmDialog open title={t('downloads.deleteTitle')} message={t('downloads.deleteMessage', download.name)}
      options={[{ label: t('common.cancel'), value: null, tone: 'ghost' }, { label: t('downloads.keepFiles'), value: false, tone: 'primary' }, { label: t('downloads.deleteFiles'), value: true, tone: 'error' }]}
      onResult={deleteFiles => { setConfirming(false); if (deleteFiles !== null) void act(() => connection.call('downloads.delete', { id: download.id, deleteFiles })) }} />}
  </div>
}
