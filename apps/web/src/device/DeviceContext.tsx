import type {
  AppInfoDto, DownloadDto, RemoteStatusDto, SearchResultDto, SeriesTaskDto, SettingsDto, SourceDto, SourceOutcomeDto,
  TransferStatusDto, UpdateStatusDto, WatchDto,
} from '@magnetar/protocol'
import { mergeByInfoHash } from '@magnetar/protocol/merge'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { pushEnabledFor } from '../lib/push.ts'
import type { ConnectionState, RpcClient } from '../lib/rpcClient.ts'
import {
  answeredAttempt, attemptKey, clickedAttempt, clockCorrected, installPhase, observedAttempt, RESTART_WITHIN_MS, restoredAttempt, type AppView,
  type InstallAttempt, type InstallPhase,
} from '../lib/updateInstall.ts'

/** What the Search page keeps while you browse other pages, like the legacy app did. */
export interface SearchState {
  /** What is typed in the search box. */
  query: string
  /** The search whose results are on screen (`searchKey`), so it isn't run twice. */
  ran: string | null
  searchId: string | null
  requestId: number
  searching: boolean
  results: SearchResultDto[] | null
  outcomes: SourceOutcomeDto[]
}

const EMPTY_SEARCH: SearchState = { query: '', ran: null, searchId: null, requestId: 0, searching: false, results: null, outcomes: [] }

export interface ReadState {
  loading: boolean
  failed: boolean
}

interface ListRead extends ReadState {
  retry: () => void
}

interface DeviceState {
  connection: RpcClient
  connectionState: ConnectionState
  info: AppInfoDto | null
  seriesRead: ListRead
  series: SeriesTaskDto[]
  watches: WatchDto[]
  settings: SettingsDto | null
  sources: SourceDto[]
  updates: UpdateStatusDto | null
  /** Where an update of the app stands: followed until the app is back, with a limit on how long it may be away. */
  installPhase: InstallPhase
  /** The version an update followed here ended on, once the app is back with it. */
  installedVersion: string | null
  /** Has the app install the update it found. Resolves once the app answered or went away to restart. */
  installUpdate: () => Promise<void>
  /** Stops following an update that did not end well, once the person has read so. */
  forgetInstall: () => void
  remote: RemoteStatusDto | null
  transfer: TransferStatusDto | null
  /** Base path of this device's pages: '' locally, '/<device name>' through the relay. */
  basePath: string
  deviceName: string
}

/**
 * Applies a progress update: changed rows are replaced, every other row keeps its object, so views
 * memoized per row skip the ones that did not change.
 */
function mergeRows(list: DownloadDto[], rows: DownloadDto[]): DownloadDto[] {
  if (rows.length === 0) return list
  const updates = new Map(rows.map(r => [r.id, r]))
  let changed = false
  const next = list.map(d => {
    const update = updates.get(d.id)
    if (!update) return d
    changed = true
    return update
  })
  return changed ? next : list
}

/** The tab's own storage, which a reload keeps; undefined where it is blocked. */
function tabStorage(): Storage | undefined {
  try {
    return globalThis.sessionStorage
  } catch {
    return undefined
  }
}

function readAttempt(key: string): InstallAttempt | null {
  try {
    return restoredAttempt(tabStorage()?.getItem(key) ?? null, Date.now())
  } catch {
    return null
  }
}

function keepAttempt(key: string, attempt: InstallAttempt | null) {
  try {
    if (attempt) tabStorage()?.setItem(key, JSON.stringify(attempt))
    else tabStorage()?.removeItem(key)
  } catch {
    // Followed until the page is reloaded only.
  }
}

/** An app older than source ids names its sources only by name; that name stands in for the id. */
const withIds = (sources: SourceDto[]) => sources.map(s => (s.id ? s : { ...s, id: s.name }))

const DeviceContext = createContext<DeviceState | null>(null)
/** Separate so the once-a-second progress updates re-render only the views that show downloads. */
const DownloadReadContext = createContext<ListRead>({ loading: true, failed: false, retry: () => {} })
const DownloadsContext = createContext<DownloadDto[]>([])
const DownloadLookupContext = createContext<ReadonlyMap<number, DownloadDto>>(new Map())
/** The search in progress, apart so typing and streamed results re-render only the search page. */
const SearchContext = createContext<SearchContextValue | null>(null)
interface SearchContextValue {
  search: SearchState
  setSearch: (update: (state: SearchState) => SearchState) => void
  /** Remembers the search page's address from `/search` on, for the links back to it. */
  setSearchAddress: (query: string) => void
}
/** The last search's address, apart so only the links back to Search re-render when it changes. */
const SearchAddressContext = createContext('')
/** Just the connection, which never changes for a device: for per-row views that only make calls. */
const ConnectionContext = createContext<RpcClient | null>(null)

/** A list's state as a read of it starts: only a list never read waits; one on screen stays while a reconnect reads it. */
export function readStarted(read: ReadState): ReadState {
  return read.loading || read.failed ? { loading: true, failed: false } : read
}

/** A list's state once a read of it failed: a list on screen stays. */
export function readFailed(read: ReadState): ReadState {
  return read.loading ? { loading: false, failed: true } : read
}

export function DeviceProvider({ connection, basePath, deviceName, children }: {
  connection: RpcClient
  basePath: string
  deviceName: string
  children: ReactNode
}) {
  const [connectionState, setConnectionState] = useState<ConnectionState>(connection.state)
  const [info, setInfo] = useState<AppInfoDto | null>(null)
  const [read, setRead] = useState<ReadState>({ loading: true, failed: false })
  // Reads the downloads and the watchlist again; set by the connection's effect.
  const readListsAgain = useRef<() => void>(() => {})
  const retryDownloads = useCallback(() => readListsAgain.current(), [])
  const readValue = useMemo<ListRead>(() => ({ ...read, retry: retryDownloads }), [read, retryDownloads])
  const [downloads, setDownloads] = useState<DownloadDto[]>([])
  const downloadsById = useMemo(() => new Map(downloads.map(d => [d.id, d])), [downloads])
  const [seriesRead, setSeriesRead] = useState<ReadState>({ loading: true, failed: false })
  const seriesReadValue = useMemo<ListRead>(() => ({ ...seriesRead, retry: retryDownloads }), [seriesRead, retryDownloads])
  const [series, setSeries] = useState<SeriesTaskDto[]>([])
  const [watches, setWatches] = useState<WatchDto[]>([])
  const [settings, setSettings] = useState<SettingsDto | null>(null)
  const [sources, setSources] = useState<SourceDto[]>([])
  const [updates, setUpdates] = useState<UpdateStatusDto | null>(null)
  const [remote, setRemote] = useState<RemoteStatusDto | null>(null)
  const [transfer, setTransfer] = useState<TransferStatusDto | null>(null)
  const [search, setSearch] = useState<SearchState>(EMPTY_SEARCH)
  const [searchAddress, setSearchAddress] = useState('')
  const [appView, setAppView] = useState<AppView>({ online: false })
  const installKey = attemptKey(connection.keyId)
  const [install, setInstall] = useState<{ attempt: InstallAttempt | null; installed: string | null }>(() => ({ attempt: readAttempt(installKey), installed: null }))
  useEffect(() => keepAttempt(installKey, install.attempt), [installKey, install.attempt])
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    let cancelled = false
    let refreshId = 0
    let downloadsVersion = 0
    let seriesVersion = 0
    let duringList = new Map<number, DownloadDto>()
    let pendingList = false
    const observe = (view: AppView) => {
      setAppView(view)
      setNow(Date.now())
      setInstall(({ attempt, installed }) => {
        const next = observedAttempt(attempt, view, Date.now())
        return { attempt: next, installed: attempt && !next && view.online ? view.running : installed }
      })
    }
    const report = (status: UpdateStatusDto) => {
      setUpdates(status)
      observe({ online: true, running: status.currentVersion, installing: status.installing })
    }
    // The two lists the pages wait for, apart from the rest so "Try again" reads only them.
    let listsId = 0
    const readLists = () => {
      const attempt = ++listsId
      const version = downloadsVersion
      const downloadsCurrent = () => !cancelled && attempt === listsId && version === downloadsVersion
      duringList = new Map()
      pendingList = true
      setRead(readStarted)
      void connection.call('downloads.list').then(list => {
        if (!downloadsCurrent()) return
        setDownloads(mergeRows(list, [...duringList.values()]))
        pendingList = false
        duringList.clear()
        setRead({ loading: false, failed: false })
      }, () => {
        if (downloadsCurrent()) { pendingList = false; duringList.clear(); setRead(readFailed) }
      })
      setSeriesRead(readStarted)
      const seriesAtRead = seriesVersion
      const seriesCurrent = () => !cancelled && attempt === listsId && seriesAtRead === seriesVersion
      void connection.call('series.list').then(list => {
        if (seriesCurrent()) { setSeries(list); setSeriesRead({ loading: false, failed: false }) }
      }, () => { if (seriesCurrent()) setSeriesRead(readFailed) })
    }
    readListsAgain.current = () => { if (!cancelled && connection.state.status === 'open') readLists() }
    const refresh = async () => {
      const attempt = ++refreshId
      readLists()
      try {
        // The website can be newer than the device's app: what an older app lacks is left out.
        const optional = <T,>(call: Promise<T>) => call.catch(() => null)
        const [i, st, src, u, r, tr] = await Promise.all([
          connection.call('app.info'),
          connection.call('settings.get'), connection.call('sources.list'), connection.call('updates.status'),
          connection.call('remote.status'), optional(connection.call('transfer.status')),
        ])
        if (cancelled || attempt !== refreshId) return
        void optional(connection.call('watches.list')).then(w => { if (!cancelled && attempt === refreshId) setWatches(w ?? []) })
        setInfo(i)
        setSettings(st)
        setSources(withIds(src))
        report(u)
        setRemote(r)
        setTransfer(tr)
      } catch {
        // The state listener retries on the next successful (re)connect.
      }
    }
    const offState = connection.onState(state => {
      setConnectionState(state)
      if (state.status === 'open') return void refresh()
      setSearch(s => (s.searching ? { ...s, searching: false } : s))
      // What the app last said of an update is no longer known: it reports again once it is back.
      observe({ online: false })
    })
    // The transport may have opened between render and this subscription.
    setConnectionState(connection.state)
    if (connection.state.status === 'open') void refresh()

    const off = [
      offState,
      connection.on('downloads.changed', list => { downloadsVersion++; pendingList = false; duringList.clear(); setDownloads(list); setRead({ loading: false, failed: false }) }),
      connection.on('downloads.updated', rows => {
        if (pendingList) for (const row of rows) duringList.set(row.id, row)
        setDownloads(list => mergeRows(list, rows))
      }),
      connection.on('transfer.changed', setTransfer),
      connection.on('series.changed', list => { seriesVersion++; setSeries(list); setSeriesRead({ loading: false, failed: false }) }),
      connection.on('watches.changed', setWatches),
      connection.on('settings.changed', next => {
        setSettings(next)
        void connection.call('sources.list').then(list => setSources(withIds(list))).catch(() => {})
      }),
      connection.on('updates.changed', report),
      connection.on('remote.changed', setRemote),
      connection.on('search.results', ({ searchId, results }) =>
        setSearch(s => (s.searchId === searchId ? { ...s, results: mergeByInfoHash([...(s.results ?? []), ...results]) } : s))),
      connection.on('search.source', ({ searchId, outcome }) =>
        setSearch(s => (s.searchId === searchId ? { ...s, outcomes: [...s.outcomes.filter(o => o.source !== outcome.source), outcome] } : s))),
      connection.on('search.done', ({ searchId }) =>
        setSearch(s => (s.searchId === searchId ? { ...s, searching: false } : s))),
      connection.on('notification', event => {
        // Pushed notifications arrive through the service worker; don't show them twice.
        if (!('Notification' in window) || Notification.permission !== 'granted' || pushEnabledFor(connection)) return
        try {
          new Notification(event.title, { body: event.message, icon: '/favicon.png' })
        } catch {
          // Some mobile browsers only allow notifications from a service worker.
        }
      }),
    ]
    return () => { cancelled = true; off.forEach(fn => fn()) }
  }, [connection])

  const awaySince = install.attempt?.offlineSince ?? null
  // Wakes the page when the wait is over, and again if it woke early, was throttled in a background tab, or the clock moved.
  useEffect(() => {
    if (awaySince === null) return
    const refresh = () => {
      const at = Date.now()
      setNow(at)
      setInstall(state => {
        const attempt = state.attempt && clockCorrected(state.attempt, at)
        return attempt === state.attempt ? state : { ...state, attempt }
      })
    }
    const left = awaySince + RESTART_WITHIN_MS - Date.now()
    if (now - awaySince >= RESTART_WITHIN_MS) return
    const timer = setTimeout(refresh, Math.min(Math.max(0, left), RESTART_WITHIN_MS))
    document.addEventListener('visibilitychange', refresh)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [awaySince, now])

  const installUpdate = useCallback(async () => {
    const sent = connection.state.status === 'open'
    if (sent) setInstall(({ attempt, installed }) => ({ attempt: clickedAttempt(attempt, installPhase(attempt, appView, Date.now()), appView.online ? appView.running : null, Date.now()), installed }))
    try {
      await connection.call('updates.install')
    } catch (error) {
      // The app going away to restart ends the call too; anything else is for the caller to show.
      if (!sent || connection.state.status === 'open') throw error
    } finally {
      if (sent) setInstall(({ attempt, installed }) => ({ attempt: answeredAttempt(attempt), installed }))
    }
  }, [connection, appView])

  const forgetInstall = useCallback(() => setInstall(({ installed }) => ({ attempt: null, installed })), [])
  const phase = installPhase(install.attempt, appView, now)
  const installedVersion = install.installed
  const value = useMemo<DeviceState>(() => ({
    connection, connectionState, info, seriesRead: seriesReadValue, series, watches, settings, sources, updates, installPhase: phase, installedVersion, installUpdate, forgetInstall,
    remote, transfer, basePath, deviceName,
  }), [connection, connectionState, info, seriesReadValue, series, watches, settings, sources, updates, phase, installedVersion, installUpdate, forgetInstall, remote, transfer, basePath, deviceName])
  const searchValue = useMemo(() => ({ search, setSearch, setSearchAddress }), [search])

  return (
    <ConnectionContext.Provider value={connection}>
      <DeviceContext.Provider value={value}>
        <SearchContext.Provider value={searchValue}>
          <SearchAddressContext.Provider value={searchAddress}>
            <DownloadReadContext.Provider value={readValue}><DownloadsContext.Provider value={downloads}><DownloadLookupContext.Provider value={downloadsById}>{children}</DownloadLookupContext.Provider></DownloadsContext.Provider></DownloadReadContext.Provider>
          </SearchAddressContext.Provider>
        </SearchContext.Provider>
      </DeviceContext.Provider>
    </ConnectionContext.Provider>
  )
}

export function useDevice(): DeviceState {
  const value = useContext(DeviceContext)
  if (!value) throw new Error('useDevice outside DeviceProvider')
  return value
}


export function useConnection(): RpcClient {
  const value = useContext(ConnectionContext)
  if (!value) throw new Error('useConnection outside DeviceProvider')
  return value
}

/** Where Search opens: the search left on screen, if any. */
export function useSearchLink(): string {
  const { basePath } = useDevice()
  const address = useContext(SearchAddressContext)
  return `${basePath}${address || '/search'}`
}

export function useSearch(): SearchContextValue {
  const value = useContext(SearchContext)
  if (!value) throw new Error('useSearch outside DeviceProvider')
  return value
}

export function useDownloads(): DownloadDto[] {
  return useContext(DownloadsContext)
}

export function useDownloadRead() { return useContext(DownloadReadContext) }

/** A shared lookup for file rows; one map is built per push instead of scanning per entry. */
export function useDownload(id: number | undefined): DownloadDto | undefined {
  const downloads = useContext(DownloadLookupContext)
  return id === undefined ? undefined : downloads.get(id)
}
