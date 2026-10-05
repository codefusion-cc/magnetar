import type { DownloadDto } from '@magnetar/protocol'
import { formatRate } from '@magnetar/protocol/bytes'
import { ArrowDown, ArrowUp, CloudDownload, Plus, Search, Tv } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { useLanguage, useT } from '../../lib/i18n.tsx'
import { DEFAULT_DOWNLOAD_VIEW, DOWNLOAD_VIEWS, countViews, inView, viewForDownload, type DownloadView } from '../../lib/downloadViews.ts'
import { DOWNLOAD_SORTS, parseDownloadSort, readDownloadSort, sortDownloads, writeDownloadSort } from '../../lib/downloadSort.ts'
import { pickParam, withParam } from '../../lib/urlState.ts'
import { magnetsIn } from '../../lib/magnets.ts'
import { PageHeader, Segmented } from '../../ui/controls.tsx'
import { Empty } from '../../ui/Empty.tsx'
import { PAGE_SIZE, ShowMore } from '../../ui/ShowMore.tsx'
import { useDevice, useDownloads, useSearchLink } from '../DeviceContext.tsx'
import { AddDownloadDialog, DropOverlay, useAddShortcuts, type PendingAdd } from '../components/addDownload.tsx'
import { DownloadDetailsDialog } from '../components/downloadDetails.tsx'
import { DownloadRow, isActive } from '../components/downloads.tsx'
import { LegacyImportBanner } from '../components/legacyImport.tsx'
import { AltSpeedToggle, DiskFullNotice, FreeSpace, TransferNotice } from '../components/transfer.tsx'

export function DownloadsPage() {
  const t = useT()
  const { basePath, settings, transfer, connection, deviceName } = useDevice()
  const downloads = useDownloads()
  const searchLink = useSearchLink()
  const [params, setParams] = useSearchParams()
  // A link to one download (?download=7) opens the view that lists it; otherwise Active unless the address says more.
  const linked = Number(params.get('download'))
  const fallback = params.has('download') ? viewForDownload(downloads, linked) : DEFAULT_DOWNLOAD_VIEW
  const view = pickParam(params, 'view', DOWNLOAD_VIEWS, fallback)
  const setView = useCallback((next: DownloadView) => setParams(current => withParam(withParam(current, 'download', ''), 'view', next, DEFAULT_DOWNLOAD_VIEW), { replace: true }), [setParams])
  const [sort, setSort] = useState(() => readDownloadSort(deviceName))
  const language = useLanguage()
  const [adding, setAdding] = useState<PendingAdd | null>(null)
  const [details, setDetails] = useState<number | null>(null)
  const dragging = useAddShortcuts(setAdding)
  // Opened for a magnet link or .torrent file (the system's handler, or a link to ?add=).
  useEffect(() => {
    const magnet = params.get('add')
    const path = connection.kind === 'local' ? params.get('torrent') : null
    if (!magnet && !path) return
    setAdding({ magnets: magnet ? magnetsIn(magnet) : [], files: [], paths: path ? [path] : [] })
    setParams(current => withParam(withParam(current, 'add', ''), 'torrent', ''), { replace: true })
  }, [params, setParams, connection])

  // One pass for the speeds and each view's count, rather than one filter per tab on each update.
  const { counts, activeNow, down, up } = useMemo(() => {
    let activeNow = 0
    let down = 0
    let up = 0
    for (const d of downloads) {
      if (isActive(d)) activeNow++
      down += d.downloadSpeed
      up += d.uploadSpeed
    }
    return { counts: countViews(downloads), activeNow, down, up }
  }, [downloads])
  const shown = useMemo(() => sortDownloads(downloads.filter(d => inView(d.status, view)), sort, language), [downloads, view, sort, language])
  const add = <button type="button" className="btn btn-primary" onClick={() => setAdding({ magnets: [], files: [] })}><Plus size={16} />{t('add.button')}</button>

  const summary = downloads.length > 0 && (
    <span className="inline-flex flex-wrap items-center gap-x-4 gap-y-1">
      <span>{t('downloads.activeCount', activeNow)}</span>
      <span className="inline-flex items-center gap-1 tabular-nums"><ArrowDown size={14} className="text-info" />{formatRate(down)}</span>
      <span className="inline-flex items-center gap-1 tabular-nums"><ArrowUp size={14} className="text-accent" />{formatRate(up)}</span>
      <FreeSpace bytes={transfer?.freeBytes} />
    </span>
  )

  return (
    <>
      <PageHeader title={t('downloads.title')} summary={summary}
        action={<div className="flex flex-wrap items-center gap-2">
          {settings && transfer && <AltSpeedToggle settings={settings} transfer={transfer} />}
          {downloads.length > 0 && <Link to={searchLink} className="btn btn-ghost hidden sm:inline-flex"><Search size={16} />{t('downloads.searchButton')}</Link>}
          {add}
        </div>} />
      <TransferNotice transfer={transfer} />
      <DiskFullNotice transfer={transfer} />
      <LegacyImportBanner />
      {downloads.length === 0 ? (
        <Empty icon={<CloudDownload size={40} strokeWidth={1.5} className="text-primary" />} title={t('downloads.emptyTitle')} text={t('downloads.emptyHint')}>
          <div className="flex flex-wrap justify-center gap-2">
            <Link to={searchLink} className="btn btn-primary"><Search size={16} />{t('downloads.searchButton')}</Link>
            <Link to={`${basePath}/series`} className="btn btn-ghost"><Tv size={16} />{t('downloads.seriesButton')}</Link>
          </div>
          <p className="muted mt-4 text-xs">{t('add.emptyHint')}</p>
        </Empty>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
            <Segmented label={t('downloads.filter')} value={view} onChange={setView}
              options={DOWNLOAD_VIEWS.map(v => ({ value: v, label: t(`downloads.view.${v}`), count: counts[v] }))} />
            {downloads.length > 1 && (
              <select className="select select-sm ml-auto w-auto rounded-full" aria-label={t('downloads.sort')} value={sort}
                onChange={e => { const next = parseDownloadSort(e.target.value); setSort(next); writeDownloadSort(deviceName, next) }}>
                {DOWNLOAD_SORTS.map(o => <option key={o} value={o}>{t(`downloads.sort.${o}`)}</option>)}
              </select>
            )}
          </div>
          {shown.length === 0
            ? (
              <div className="surface muted flex flex-col items-center gap-2 p-6 text-center text-sm">
                <p>{t(view === 'active' ? 'downloads.noneActive' : 'downloads.noneFinished')}</p>
                {view === 'active' && counts.finished > 0 && (
                  <button type="button" className="link link-hover" onClick={() => setView('finished')}>{t('downloads.showFinished', counts.finished)}</button>
                )}
              </div>
            )
            : <DownloadList key={view} downloads={shown} onOpen={setDetails} />}
        </>
      )}
      <AddDownloadDialog open={adding !== null} initial={adding} onClose={() => setAdding(null)} />
      <DownloadDetailsDialog id={details} onClose={() => setDetails(null)} />
      {dragging && <DropOverlay />}
    </>
  )
}

/** Downloads as cards, a page at a time; each from a series names it. */
export function DownloadList({ downloads, hideSeries = false, onOpen }: { downloads: DownloadDto[]; hideSeries?: boolean; onOpen?: (id: number) => void }) {
  const t = useT()
  const { series } = useDevice()
  const [limit, setLimit] = useState(PAGE_SIZE)
  const [opened, setOpened] = useState<number | null>(null)
  const names = useMemo(() => new Map(series.map(s => [s.id, s.name])), [series])
  const unknown = t('downloads.unknownSeries')
  const seriesName = (d: DownloadDto) => (d.seriesTaskId === null || hideSeries ? undefined : names.get(d.seriesTaskId) || unknown)
  const open = useCallback((id: number) => (onOpen ?? setOpened)(id), [onOpen])
  return (
    <>
      <ul className="flex flex-col gap-2">
        {downloads.slice(0, limit).map(d => <DownloadRow key={d.id} download={d} seriesName={seriesName(d)} onOpen={open} />)}
      </ul>
      {downloads.length > limit && <ShowMore remaining={downloads.length - limit} onMore={() => setLimit(n => n + PAGE_SIZE)} />}
      {!onOpen && <DownloadDetailsDialog id={opened} onClose={() => setOpened(null)} />}
    </>
  )
}
