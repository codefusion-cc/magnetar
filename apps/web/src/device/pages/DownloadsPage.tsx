import type { DownloadDto } from '@magnetar/protocol'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { useLanguage, useT } from '../../lib/i18n.tsx'
import { DEFAULT_DOWNLOAD_VIEW, DOWNLOAD_VIEWS, inView, type DownloadView } from '../../lib/downloadViews.ts'
import { DOWNLOAD_SORTS, parseDownloadSort, readDownloadSort, sortDownloads, writeDownloadSort } from '../../lib/downloadSort.ts'
import { pickParam, withParam } from '../../lib/urlState.ts'
import { downloadBytes, downloadSummary, retainFinished } from '../../lib/downloadPresentation.ts'
import { Segmented } from '../../ui/controls.tsx'
import { Star } from '../../ui/Star.tsx'
import { magnetsIn } from '../../lib/magnets.ts'
import { useSteadySpeeds } from '../../lib/steadySpeed.ts'
import { PAGE_SIZE, ShowMore } from '../../ui/ShowMore.tsx'
import { useDevice, useDownloads, useDownloadRead, useSearchLink } from '../DeviceContext.tsx'
import { AddDownloadDialog, DropOverlay, useAddShortcuts, type PendingAdd } from '../components/addDownload.tsx'
import { DownloadDetailsDialog } from '../components/downloadDetails.tsx'
import { DownloadRow } from '../components/downloads.tsx'
import { LegacyImportBanner } from '../components/legacyImport.tsx'
import { AltSpeedToggle, DiskFullNotice, TransferNotice } from '../components/transfer.tsx'

export function DownloadsPage() {
  const t = useT()
  const { basePath, settings, transfer, connection, deviceName } = useDevice()
  const downloads = useDownloads()
  const searchLink = useSearchLink()
  const [params, setParams] = useSearchParams()
  const view = pickParam(params, 'view', DOWNLOAD_VIEWS, DEFAULT_DOWNLOAD_VIEW)
  const setView = useCallback((next: DownloadView) => setParams(current => withParam(current, 'view', next, DEFAULT_DOWNLOAD_VIEW), { replace: true }), [setParams])
  const [sort, setSort] = useState(() => readDownloadSort(deviceName))
  const language = useLanguage()
  const [adding, setAdding] = useState<PendingAdd | null>(null)
  const navigate = useNavigate()
  const openDetails = useCallback((id: number) => navigate(`${basePath}/downloads/${id}`), [navigate, basePath])
  const read = useDownloadRead()
  const retained = useRef<{ view: DownloadView; ids: Set<number> }>({ view, ids: new Set() })
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
  const running = downloads.filter(d => d.status === 'Downloading')
  const up = downloads.reduce((sum, d) => sum + (speeds.get(d.id)?.up ?? 0), 0)
  const down = running.reduce((sum, d) => sum + (speeds.get(d.id)?.down ?? 0), 0)
  if (retained.current.view !== view) retained.current = { view, ids: new Set() }
  retained.current.ids = retainFinished(retained.current.ids, downloads)
  const shown = sortDownloads(downloads.filter(d => inView(d.status, view) || (view === 'active' && retained.current.ids.has(d.id))), sort, language)
  const add = <button type="button" className="infall-button" onClick={() => setAdding({ magnets: [], files: [] })}>{t('add.button')}</button>
  const heading = <header className="downloads-heading"><h1>{t('downloads.title')}</h1>{add}</header>

  return (
    <>
      <TransferNotice transfer={transfer} />
      <DiskFullNotice transfer={transfer} />
      <LegacyImportBanner />
      {read.loading ? <><div className="downloads-wait" role="status"><Star breathe /><p>{t('downloads.connecting', deviceName)}</p></div><ul className="download-skeleton" aria-hidden="true">{Array.from({ length: 4 }, (_, i) => <li key={i}><i /><i /></li>)}</ul></>
        : read.failed ? <>{heading}<section className="download-empty" role="alert"><div className="download-state-picture"><Star state="out" /></div><h1>{t('downloads.readFailed')}</h1><p>{t('downloads.readFailedHint', deviceName)}</p><button className="infall-button" onClick={read.retry}>{t('downloads.tryAgain')}</button></section></>
        : <>{heading}{downloads.length === 0 ? (
          <section className="download-empty"><div className="download-state-picture"><Star /></div><h1>{t('downloads.emptyTitle')}</h1><p>{t('downloads.emptyHint')}</p>
            <div className="infall-acts"><Link to={searchLink} className="infall-button">{t('downloads.searchButton')}</Link><Link to={`${basePath}/series`} className="download-watchlist-link">{t('nav.series')}</Link></div>
          </section>
        ) : <div className="downloads-lanes">
          <div className="downloads-summary"><p>{transfer?.engine === 'waitingForNetwork' ? t('downloads.onlyNetwork', deviceName, transfer.networkInterface ?? '') : downloadSummary(t, language, deviceName, running.length, down)}{' '}
            {transfer?.freeBytes != null && <span className={transfer.freeBytes < 5e9 ? 'download-low-space' : undefined}>{t('downloads.free', downloadBytes(transfer.freeBytes, language))}</span>} {up > 0 && <span>{t('downloads.uploading', `${downloadBytes(up, language)}/s`)}</span>} {settings && <AltSpeedToggle settings={settings} transfer={transfer} />}</p>
          </div>
          <div className="download-views-row"><Segmented appearance="quiet" label={t('downloads.filter')} value={view} onChange={setView}
            options={DOWNLOAD_VIEWS.map(v => ({ value: v, label: t(`downloads.view.${v}`) }))} />
          {downloads.length > 1 && <select className="download-sort" aria-label={t('downloads.sort')} value={sort}
            onChange={e => { const next = parseDownloadSort(e.target.value); setSort(next); writeDownloadSort(deviceName, next) }}>
            {DOWNLOAD_SORTS.map(o => <option key={o} value={o}>{t(`downloads.sort.${o}`)}</option>)}
          </select>}</div>
          {shown.length === 0 ? <p className="muted py-6">{t(view === 'active' ? 'downloads.noneActive' : 'downloads.noneFinished')}</p> : <DownloadList key={view} downloads={shown} onOpen={openDetails} />}
        </div>}</>}
      <AddDownloadDialog open={adding !== null} initial={adding} onClose={() => setAdding(null)} />
      {dragging && <DropOverlay />}
    </>
  )
}

/** Downloads in rows, limited a page at a time; series callers reuse the same list. */
export function DownloadList({ downloads, hideSeries = false, onOpen }: { downloads: DownloadDto[]; hideSeries?: boolean; onOpen?: (id: number) => void }) {
  const t = useT()
  const { series } = useDevice()
  const [limit, setLimit] = useState(PAGE_SIZE)
  const [opened, setOpened] = useState<number | null>(null)
  const names = useMemo(() => new Map(series.map(s => [s.id, s.name])), [series])
  const unknown = t('downloads.unknownSeries')
  const seriesName = (d: DownloadDto) => (d.seriesTaskId === null || hideSeries ? undefined : names.get(d.seriesTaskId) || unknown)
  const open = useCallback((id: number) => (onOpen ?? setOpened)(id), [onOpen])
  const speeds = useSteadySpeeds(downloads)
  return (
    <>
      <ul className={`download-list${downloads.length > PAGE_SIZE ? ' download-list-many' : ''}`}>
        {downloads.slice(0, limit).map(d => <DownloadRow key={d.id} download={d} {...speeds.get(d.id)!} seriesName={seriesName(d)} onOpen={open} />)}
      </ul>
      {downloads.length > limit && <ShowMore remaining={downloads.length - limit} onMore={() => setLimit(n => n + PAGE_SIZE)} />}
      {!onOpen && <DownloadDetailsDialog id={opened} onClose={() => setOpened(null)} />}
    </>
  )
}
