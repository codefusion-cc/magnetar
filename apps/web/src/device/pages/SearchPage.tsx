import type { SearchResultDto, SourceOutcomeDto, TorrentDetailsDto } from '@magnetar/protocol'
import { formatBytes } from '@magnetar/protocol/bytes'
import { Check, Copy, Download, ExternalLink, Sprout } from 'lucide-react'
import { memo, useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router'
import { askingWhere } from '../../lib/downloadFlow.ts'
import { noticeExtra, offersOtherFolder, startedNotice } from '../../lib/recentFolders.ts'
import { errorMessage } from '../../lib/errors.ts'
import { useFormatDate, useFormatRelative, useLanguage, useT } from '../../lib/i18n.tsx'
import { RESOLUTIONS } from '../../lib/quality.ts'
import { readSearch, searchAddress, searchKey, type SearchChoices } from '../../lib/urlState.ts'
import { askNotificationPermission } from '../../lib/notifications.ts'
import { downloadBytes } from '../../lib/downloadPresentation.ts'
import { searchCount, searchSummary } from '../../lib/searchPresentation.ts'
import { releaseTags } from '../../lib/releaseTags.ts'
import { Segmented } from '../../ui/controls.tsx'
import { Modal } from '../../ui/Modal.tsx'
import { PAGE_SIZE, ShowMore } from '../../ui/ShowMore.tsx'
import { useCopy, useToast } from '../../ui/toast.tsx'
import { useDevice, useSearch } from '../DeviceContext.tsx'
import { resolutionOptions } from '../components/qualityFields.tsx'
import { useDownloadFlow } from '../useDownloadFlow.tsx'
import { useRun } from '../useRun.ts'


let nextSearchRequest = 0

type Sort = 'seeders' | 'newest' | 'largest' | 'smallest'
const SORTS: Record<Sort, (a: SearchResultDto, b: SearchResultDto) => number> = {
  seeders: (a, b) => b.seeders - a.seeders,
  newest: (a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''),
  largest: (a, b) => b.sizeBytes - a.sizeBytes,
  smallest: (a, b) => a.sizeBytes - b.sizeBytes,
}
/** Each sort and its word in addresses (`?sort=new`); the first is the default, left out of them. */
const SORT_WORDS: SearchChoices<string, Sort>['sorts'] = [['seeders', 'seeders'], ['newest', 'new'], ['largest', 'large'], ['smallest', 'small']]
const SORT_NAMES = SORT_WORDS.map(([sort]) => sort)

/** Starts a download and says so, with a way to go and watch it; or asks where to save it first. */
function useStartDownload(onStarted: (result: SearchResultDto) => void) {
  const t = useT()
  const toast = useToast()
  const navigate = useNavigate()
  const { connection, basePath } = useDevice()
  return useDownloadFlow<SearchResultDto>({
    start: async (result, folder) => {
      askNotificationPermission()
      await connection.call('downloads.start', { resultId: result.resultId, folder: folder?.trim() || undefined })
    },
    started: (result, folder, always) => {
      const notice = startedNotice({ plain: 'search.started', inFolder: 'search.startedIn' }, folder, always)
      toast(t(notice.key, result.title, notice.folder ?? '') + noticeExtra(t, notice), 'success', { label: t('search.viewDownloads'), onClick: () => navigate(basePath || '/') })
      onStarted(result)
    },
    failed: error => toast(t('search.startFailed', errorMessage(error)), 'error'),
    subject: result => ({ name: result.title, bytes: result.sizeBytes }),
  })
}

export function SearchPage() {
  const t = useT()
  const { connection, connectionState, sources, basePath, settings, deviceName } = useDevice()
  const { search, setSearch, setSearchAddress } = useSearch()
  const navigate = useNavigate()
  const run = useRun()
  const [details, setDetails] = useState<SearchResultDto | null>(null)
  const [added, setAdded] = useState<Set<string>>(new Set())
  const { ask } = askingWhere(settings)
  const { request, busy, browser } = useStartDownload(result => {
    setAdded(s => new Set(s).add(result.resultId))
    setDetails(null)
  })
  const [shown, setShown] = useState(PAGE_SIZE)
  // The search on screen lives in the address bar (/search/dragon?res=720p&source=tpb&sort=new), so a
  // reload, a bookmark, a shared link or Back shows the same one.
  const [params] = useSearchParams()
  const location = useLocation()
  const segment = location.pathname.slice(`${basePath}/search`.length).replace(/^\//, '')
  const choices = useMemo<SearchChoices<string, Sort>>(() => ({
    resolutions: RESOLUTIONS, sorts: SORT_WORDS, sources,
  }), [sources])
  const view = useMemo(() => readSearch(segment, params, choices), [segment, params, choices])
  const { sort } = view
  const key = searchKey(view)
  const address = searchAddress(view, choices)
  // A source in the address is checked against the device's own once they are known.
  const settled = !params.get('source') || sources.length > 0
  const proper = !settled || `/search${segment ? `/${segment}` : ''}${location.search}` === address
  const show = (change: Partial<typeof view>, how: { replace: boolean }) => navigate(basePath + searchAddress({ ...view, ...change }, choices), how)

  const starting = useRef<string | null>(null)
  const start = async (target: typeof view) => {
    const targetKey = searchKey(target)
    if (starting.current === targetKey || (search.searching && search.ran === targetKey)) return
    starting.current = targetKey
    const own = ++nextSearchRequest
    if (search.searchId && search.searching) void connection.call('search.cancel', { searchId: search.searchId }).catch(() => {})
    setShown(PAGE_SIZE)
    setSearch(s => ({ ...s, query: target.query, ran: searchKey(target), searching: true, results: [], outcomes: [], searchId: null, requestId: own }))
    const query = [target.query, target.resolution].filter(Boolean).join(' ')
    const started = await run(() => connection.call('search.start', { query, source: target.source || undefined }), 'search.failed')
    if (starting.current === targetKey) starting.current = null
    if (!started) return setSearch(s => s.requestId !== own ? s : ({ ...s, searching: false, results: [], outcomes: sources.filter(x => x.enabled && (!target.source || x.id === target.source)).map(x => ({ source: x.name, status: 'failed', returned: 0, filtered: 0, error: null })) }))
    setSearch(s => s.requestId !== own ? s : ({ ...s, searchId: started.searchId }))
  }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    const query = search.query.trim()
    if (!query) return
    // The same search again is a refresh; a new one is a new history entry, so Back returns to the last.
    if (query === view.query) void start(view)
    else show({ query }, { replace: false })
  }
  // An older or untidy address (?q=dragon&source=The+Pirate+Bay&sort=newest) becomes the proper one in place.
  useEffect(() => {
    if (!proper) navigate(basePath + address + location.hash, { replace: true })
  }, [proper, address])
  // Runs the search the address describes, once connected and the address is the proper one, unless it is
  // the one already on screen.
  useEffect(() => {
    if (key && key !== search.ran && settled && proper && connectionState.status === 'open') void start(view)
  }, [key, settled, proper, connectionState.status])
  // The links back to Search open this one again.
  useEffect(() => {
    if (key && proper) setSearchAddress(address)
  }, [key, proper, address])

  const results = useMemo(() => (search.results ? [...search.results].sort(SORTS[sort]) : null), [search.results, sort])
  const downloadTo = useCallback((result: SearchResultDto) => request(result, true), [request])

  return (
    <>
      <header className="downloads-heading"><h1>{t('search.title')}</h1></header>
      <form onSubmit={submit} className="search-query">
        <input type="search" enterKeyHint="search" autoComplete="off" aria-label={t('search.query')} value={search.query}
          onChange={e => setSearch(s => ({ ...s, query: e.target.value }))} />
        <button type="submit" className="infall-button" disabled={search.searching || !search.query.trim()}>{t('search.button')}</button>
      </form>
      <div className="search-filters">
        <Segmented appearance="quiet" label={t('search.resolution')} value={view.resolution}
          onChange={resolution => show({ resolution }, { replace: true })} options={resolutionOptions(t)} />
        <label className="search-select"><span className="sr-only">{t('search.source')}</span>
          <select aria-label={t('search.source')} value={view.source} onChange={e => show({ source: e.target.value }, { replace: true })}>
            <option value="">{t('search.allSources')}</option>
            {sources.filter(s => s.enabled || s.id === view.source).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <label className="search-select search-sort"><span>{t('search.sort')}</span>
          <select value={sort} onChange={e => show({ sort: e.target.value as Sort }, { replace: true })}>
            {SORT_NAMES.map(s => <option key={s} value={s}>{t(`search.sort.${s}`)}</option>)}
          </select>
        </label>
      </div>
      <Outcomes outcomes={search.outcomes} total={results?.length ?? 0} searching={search.searching}
        query={view.query} ran={search.ran !== null} source={view.source} />
      {!!results?.length && <>
        <ul className="search-results">
          {results.slice(0, shown).map((r, i) => <ResultRow key={r.resultId} result={r} best={i === 0} busy={busy} added={added.has(r.resultId)} onOpen={setDetails} onDownload={request} />)}
        </ul>
        {results.length > shown && <ShowMore remaining={results.length - shown} onMore={() => setShown(n => n + PAGE_SIZE)} />}
      </>}
      {search.searching && <ul className="download-skeleton" aria-label={t('search.searching')}>{[0, 1].map(i => <li key={i}><i /><i /></li>)}</ul>}
      {search.ran && !search.searching && !results?.length && <>
        <p className="search-hint">{t(search.outcomes.length && search.outcomes.every(o => o.status === 'failed') ? 'search.networkHint' : 'search.noResultsHint', deviceName)}</p>
        {search.outcomes.length > 0 && search.outcomes.every(o => o.status === 'failed') && <p className="infall-acts"><button className="infall-button" onClick={() => void start(view)}>{t('downloads.tryAgain')}</button></p>}
      </>}
      {search.ran && !search.searching && <button type="button" className="search-watch" onClick={() => navigate(`${basePath}/series/releases`, { state: { watch: { query: view.query, resolution: view.resolution || null } } })}>{t('watch.fromSearch')}</button>}

      <TorrentInfoDialog result={details} added={details ? added.has(details.resultId) : false} onClose={() => setDetails(null)}
        onDownload={request} onDownloadTo={downloadTo} ask={ask} />
      {browser}
    </>
  )
}

function Health({ seeders }: { seeders: number }) {
  const t = useT()
  const tone = seeders >= 10 ? 'text-success' : seeders > 0 ? 'text-warning' : 'text-error'
  return (
    <span className={`inline-flex items-center gap-1 font-medium tabular-nums ${tone}`} title={`${t('search.seeders', seeders)} — ${t('search.seedersHint')}`}
      aria-label={t('search.seeders', seeders)}>
      <Sprout size={13} aria-hidden />{seeders}
    </span>
  )
}

function Tags({ title }: { title: string }) {
  const tags = releaseTags(title)
  const list = [tags.resolution, tags.hdr, tags.codec, tags.source].filter(Boolean)
  if (list.length === 0) return null
  return (
    <span className="inline-flex flex-wrap gap-1">
      {list.map(tag => (
        <span key={tag} className={`badge badge-sm font-semibold ${tag === tags.resolution ? 'badge-neutral' : 'badge-ghost border-base-300'}`}>{tag}</span>
      ))}
    </span>
  )
}

const ResultRow = memo(function ResultRow({ result: r, added, best, busy, onOpen, onDownload }: {
  result: SearchResultDto
  added: boolean
  best: boolean
  busy: boolean
  onOpen: (result: SearchResultDto) => void
  onDownload: (result: SearchResultDto) => void
}) {
  const t = useT()
  const formatRelative = useFormatRelative('long')
  const label = added ? t('search.added') : t('common.download')
  const language = useLanguage()
  const tags = releaseTags(r.title)
  const merit = Math.min(1, Math.log(r.seeders + 1) / Math.log(125))
  return (
    <li style={{ '--m': merit } as React.CSSProperties}>
      <i className="gl" aria-hidden="true" />
      <div className="res-b">
        <h2><button type="button" onClick={() => onOpen(r)}>{r.title}</button></h2>
        <p className="search-meta"><span className="tags">{[tags.resolution, tags.hdr, tags.source, tags.codec].filter(Boolean).join(' ')}</span>
          <span>{downloadBytes(r.sizeBytes, language)}</span><span>{searchCount(t, language, 'seeders', r.seeders)}</span>
          {r.publishedAt && <span>{formatRelative(r.publishedAt)}</span>}<span>{r.source}</span>
        </p>
      </div>
      <button type="button" className={`infall-button ${best && !added ? '' : 'quiet'}`} disabled={added || busy}
        onClick={() => onDownload(r)} aria-label={`${label}: ${r.title}`}>{label}</button>
    </li>
  )
})

/** A source stays visible while it is answering, including a failed or empty answer. */
function Outcomes({ outcomes, total, searching, query, ran, source }: { outcomes: SourceOutcomeDto[]; total: number; searching: boolean; query: string; ran: boolean; source: string }) {
  const t = useT()
  const language = useLanguage()
  const { sources } = useDevice()
  const enabled = sources.filter(s => s.enabled && (!source || s.id === source))
  const list = enabled.map(s => ({ ...s, outcome: outcomes.find(o => o.source === s.name) }))
  const { line, allFailed } = searchSummary(t, language, { outcomes: list.flatMap(s => s.outcome ? [s.outcome] : []), total, sourceCount: list.length, searching, ran, query })
  return <div className="search-sources">
    <p role={allFailed ? 'alert' : 'status'} className={allFailed ? 'text-error' : ''}>{line}</p>
    <div className="source-figure">
      <svg className="search-fan" viewBox="0 0 1000 162" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="fan-heat"><stop stopColor="var(--mg-h0)" /><stop offset="1" stopColor="var(--mg-h2)" /></linearGradient></defs>
        {list.map((s, i) => <path key={s.id} d={`M 240 ${i * 27 + 13} Q 620 ${i * 27 + 13} 940 155`} fill="none" stroke="url(#fan-heat)" opacity={s.outcome?.status === 'ok' && s.outcome.returned ? '.35' : '.08'} />)}
      </svg>
      <ul>{list.map(({ id, name, outcome }) => <li key={id} className={!outcome || outcome.status === 'failed' || !outcome.returned ? 'none' : ''} title={outcome ? outcome.status === 'failed' ? t('search.outcomeFailedDetail', outcome.error ?? '') : outcome.filtered ? t('search.outcomeFiltered', outcome.returned - outcome.filtered, outcome.returned, outcome.filtered) : t('search.outcomeOk', outcome.returned) : undefined}>
        <span>{name}</span><b>{outcome ? outcome.status === 'failed' ? t('search.outcomeFailed') : outcome.returned - outcome.filtered : searching ? t('search.asking') : ''}</b>
      </li>)}</ul>
    </div>
  </div>
}

/** Sites that only give a day report it as midnight UTC; a time of day would be made up. */
const isDayOnly = (iso: string | null) => iso !== null && /T00:00:00(\.0+)?(Z|\+00:00)$/.test(iso)

/** Details fetched on demand: the only time a lazy source's detail page is loaded. */
function TorrentInfoDialog({ result, added, onClose, onDownload, onDownloadTo, ask }: {
  result: SearchResultDto | null
  added: boolean
  onClose: () => void
  onDownload: (r: SearchResultDto) => void
  onDownloadTo: (r: SearchResultDto) => void
  ask: boolean
}) {
  const t = useT()
  const formatDate = useFormatDate()
  const copy = useCopy(t('info.copied'))
  const { connection } = useDevice()
  const [details, setDetails] = useState<TorrentDetailsDto | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setDetails(null)
    if (!result) return
    let cancelled = false
    setLoading(true)
    connection.call('search.details', { resultId: result.resultId })
      .then(d => { if (!cancelled) setDetails(d) })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [result, connection])

  if (!result) return <Modal open={false} title="" onClose={onClose}>{null}</Modal>
  const row = details?.result ?? result
  const facts: [string, React.ReactNode][] = [
    [t('info.size'), formatBytes(row.sizeBytes, 2)],
    [t('info.seeders'), <Health key="h" seeders={row.seeders} />],
    [t('info.leechers'), row.leechers],
    [t('info.published'), formatDate(row.publishedAt, !isDayOnly(row.publishedAt))],
    [t('info.source'), row.source],
  ]
  return (
    <Modal open title={t('info.title')} onClose={onClose} wide
      actions={<>
        {row.detailsUrl && <a className="btn btn-ghost btn-sm mr-auto" href={row.detailsUrl} target="_blank" rel="noreferrer noopener"><ExternalLink size={14} />{t('info.openPage')}</a>}
        {offersOtherFolder(ask) && !added && (
          <button type="button" className="link link-hover mr-1 text-sm" onClick={() => onDownloadTo(result)}>{t('info.saveElsewhere')}</button>
        )}
        <button type="button" className="btn btn-primary btn-sm" disabled={added} onClick={() => onDownload(result)}>
          {added ? <Check size={14} /> : <Download size={14} />}{added ? t('search.added') : t('common.download')}
        </button>
      </>}>
      <p className="break-release mb-3 text-lg font-semibold leading-snug">{row.title}</p>
      <div className="mb-4"><Tags title={row.title} /></div>
      <dl className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {facts.map(([label, value]) => (
          <div key={label} className="rounded-field bg-base-200 px-3 py-2">
            <dt className="muted text-xs">{label}</dt>
            <dd className="mt-0.5 text-sm font-medium tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      {loading && <p className="muted mb-3 flex items-center gap-2 text-sm"><span className="loading loading-spinner loading-xs" />{t('info.resolving')}</p>}
      {details?.description && (
        <>
          <h4 className="mb-1 text-sm font-semibold">{t('info.description')}</h4>
          <pre className="mb-4 max-h-56 overflow-y-auto whitespace-pre-wrap rounded-field bg-base-200 p-3 font-sans text-sm">{details.description}</pre>
        </>
      )}
      {(row.infoHash || details?.magnetUri) && (
        <div className="flex flex-col gap-2">
          {row.infoHash && <p className="muted break-release font-mono text-xs">{t('info.infoHash')}: {row.infoHash}</p>}
          {details?.magnetUri && (
            <button type="button" className="btn btn-ghost btn-sm self-start" onClick={() => void copy(details.magnetUri!)}><Copy size={14} />{t('info.copyMagnet')}</button>
          )}
        </div>
      )}
    </Modal>
  )
}
