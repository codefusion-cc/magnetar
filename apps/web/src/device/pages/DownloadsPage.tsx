import type { DownloadDto } from '@magnetar/protocol'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { useFormatBytes, useFormatRate, useLanguage, useT } from '../../lib/i18n.tsx'
import { DEFAULT_DOWNLOAD_VIEW, DOWNLOAD_VIEWS, inView, isRunning, type DownloadView } from '../../lib/downloadViews.ts'
import { DOWNLOAD_SORTS, readDownloadSort, sortDownloads, writeDownloadSort } from '../../lib/downloadSort.ts'
import { pickParam, withParam } from '../../lib/urlState.ts'
import { downloadSummary, retainFinished } from '../../lib/downloadPresentation.ts'
import { Select } from '../../ui/Select.tsx'
import { Segmented } from '../../ui/controls.tsx'
import { Empty } from '../../ui/Empty.tsx'
import { LanesSky } from '../../ui/sky/Sky.tsx'
import { Loading } from '../../ui/Loading.tsx'
import { magnetsIn } from '../../lib/magnets.ts'
import { useSteadySpeeds } from '../../lib/steadySpeed.ts'
import { PAGE_SIZE, ShowMore } from '../../ui/ShowMore.tsx'
import { useDevice, useDownloads, useDownloadRead, useSearchLink } from '../DeviceContext.tsx'
import { AddDownloadDialog, DropOverlay, useAddShortcuts, type PendingAdd } from '../components/addDownload.tsx'
import { DownloadRow } from '../components/downloads.tsx'
import { LegacyImportBanner } from '../components/legacyImport.tsx'
import { AltSpeedToggle, DiskFullNotice, TransferNotice } from '../components/transfer.tsx'

export function DownloadsPage() {
  const t = useT()
  const bytes = useFormatBytes()
  const rate = useFormatRate()
  const { settings, transfer, connection, deviceName } = useDevice()
  const downloads = useDownloads()
  const searchLink = useSearchLink()
  const [params, setParams] = useSearchParams()
  const view = pickParam(params, 'view', DOWNLOAD_VIEWS, DEFAULT_DOWNLOAD_VIEW)
  const setView = useCallback((next: DownloadView) => setParams(current => withParam(current, 'view', next, DEFAULT_DOWNLOAD_VIEW), { replace: true }), [setParams])
  const [sort, setSort] = useState(() => readDownloadSort(deviceName))
  const language = useLanguage()
  const [adding, setAdding] = useState<PendingAdd | null>(null)
  const read = useDownloadRead()
  const retained = useRef<{ view: DownloadView; ids: Set<number>; downloads: DownloadDto[] }>({ view, ids: new Set(), downloads: [] })
  const dragging = useAddShortcuts(setAdding)
  // Opened for a magnet link or .torrent file (the system's handler, or a link to ?add=).
  useEffect(() => {
    const magnet = params.get('add')
    const path = connection.kind === 'local' ? params.get('torrent') : null
    if (!magnet && !path) return
    setAdding({ magnets: magnet ? magnetsIn(magnet) : [], files: [], paths: path ? [path] : [] })
    setParams(current => withParam(withParam(current, 'add', ''), 'torrent', ''), { replace: true })
  }, [params, setParams, connection])

  const speeds = useSteadySpeeds(downloads)
  const { running, up, down } = useMemo(() => {
    let running = 0, up = 0, down = 0
    for (const d of downloads) {
      const speed = speeds.get(d.id)
      up += speed?.up ?? 0
      if (isRunning(d)) { running++; down += speed?.down ?? 0 }
    }
    return { running, up, down }
  }, [downloads, speeds])
  const shown = useMemo(() => {
    const previous = retained.current
    const ids = view === 'active' && previous.view === view ? retainFinished(previous.ids, previous.downloads, downloads) : new Set<number>()
    retained.current = { view, ids, downloads }
    return sortDownloads(downloads.filter(d => inView(d.status, view) || (view === 'active' && ids.has(d.id))), sort, language)
  }, [downloads, view, sort, language])
  const add = <button type="button" className="infall-button" onClick={() => setAdding({ magnets: [], files: [] })}>{t('add.button')}</button>
  const heading = <header className="downloads-heading"><h1>{t('downloads.title')}</h1>{add}</header>

  const frame = (content: ReactNode) => <>
    <TransferNotice transfer={transfer} />
    <DiskFullNotice transfer={transfer} />
    <LegacyImportBanner />
    {content}
    <AddDownloadDialog open={adding !== null} initial={adding} onClose={() => setAdding(null)} />
    {dragging && <DropOverlay />}
  </>
  if (read.loading) return frame(<Loading text={t('downloads.connecting', deviceName)} rows={4} />)
  if (read.failed) return frame(<>{heading}<Empty appearance="page" role="alert" state="far" title={t('downloads.readFailed')} text={t('downloads.readFailedHint', deviceName)} onRetry={read.retry} /></>)
  if (downloads.length === 0) return frame(<>{heading}<Empty appearance="page" title={t('downloads.emptyTitle')} text={t('downloads.emptyHint')}>
    <div className="infall-acts"><Link to={searchLink} className="infall-button">{t('downloads.searchButton')}</Link></div>
  </Empty></>)
  return frame(<>{heading}<LanesSky><div className="downloads-lanes">
    <div className="downloads-summary"><p>{transfer?.engine === 'waitingForNetwork' ? t('downloads.onlyNetwork', deviceName, transfer.networkInterface ?? '') : downloadSummary(t, language, deviceName, running, down)}{' '}
      {transfer?.freeBytes != null && <span className={transfer.freeBytes < 5e9 ? 'download-low-space' : undefined}>{t('downloads.free', bytes(transfer.freeBytes))}</span>} {up > 0 && <span>{t('downloads.uploading', rate(up))}</span>} {settings && <AltSpeedToggle settings={settings} transfer={transfer} />}</p>
    </div>
    <div className="download-views-row"><Segmented appearance="quiet" label={t('downloads.filter')} value={view} onChange={setView}
      options={DOWNLOAD_VIEWS.map(v => ({ value: v, label: t(`downloads.view.${v}`) }))} />
    {downloads.length > 1 && <Select look="quiet" className="ml-auto" label={t('downloads.sort')} value={sort}
      onChange={next => { setSort(next); writeDownloadSort(deviceName, next) }}
      options={DOWNLOAD_SORTS.map(o => ({ value: o, label: t(`downloads.sort.${o}`) }))} />}</div>
    {shown.length === 0 ? <p className="muted py-6">{t(view === 'active' ? 'downloads.noneActive' : 'downloads.noneFinished')}</p> : <DownloadList key={view} downloads={shown} />}
  </div></LanesSky></>)
}

/** Downloads in rows, limited a page at a time; series callers reuse the same list. */
export function DownloadList({ downloads, hideSeries = false }: { downloads: DownloadDto[]; hideSeries?: boolean }) {
  const t = useT()
  const { series, basePath } = useDevice()
  const navigate = useNavigate()
  const [limit, setLimit] = useState(PAGE_SIZE)
  const names = useMemo(() => new Map(series.map(s => [s.id, s.name])), [series])
  const unknown = t('downloads.unknownSeries')
  const seriesName = (d: DownloadDto) => (d.seriesTaskId === null || hideSeries ? undefined : names.get(d.seriesTaskId) || unknown)
  const open = useCallback((id: number) => navigate(`${basePath}/downloads/${id}`), [navigate, basePath])
  const speeds = useSteadySpeeds(downloads)
  return (
    <>
      <ul aria-label={t('downloads.title')} className={`download-list${downloads.length > PAGE_SIZE ? ' download-list-many' : ''}`}>
        {downloads.slice(0, limit).map(d => <DownloadRow key={d.id} download={d} {...speeds.get(d.id)!} seriesName={seriesName(d)} onOpen={open} />)}
      </ul>
      {downloads.length > limit && <ShowMore remaining={downloads.length - limit} onMore={() => setLimit(n => n + PAGE_SIZE)} />}
    </>
  )
}
