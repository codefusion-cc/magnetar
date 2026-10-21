import type { DownloadDto, DownloadFileDto, FolderEntryDto, RpcEvents, RpcResults, SettingsDto } from '@magnetar/protocol'
import type { Page, WebSocketRoute } from '@playwright/test'
import { acceptBrowserHandshake, decodeHandshake, encodeHandshake, FRAME_HANDSHAKE, importBrowserKey, type E2ESession } from '@magnetar/protocol/e2e'
import { seedDeviceKeys } from './keys.ts'
import { infallDownloads, infallFiles, infallSources, infallSearch, infallSeries, infallWatches, infallRoots, infallFolder, type InfallScreen } from './infall.ts'

/** A device at the network boundary; the dashboard, transport and subscriptions stay real. */
export async function serveDevice(page: Page, { name = 'Test computer', language = 'en', design, remote = false, delay = 0, holdList = false, manualSearch = false }: { name?: string; language?: string; design?: InfallScreen; remote?: boolean; delay?: number; holdList?: boolean; manualSearch?: boolean } = {}) {
  if (design) name = 'Mac-Mini-M1'
  const calls: string[] = []
  /** Every call with its parameters, for tests that care what was asked, not only that it was. */
  const log: { method: string; params: Record<string, any> }[] = []
  const failures = new Map<string, { message: string; code: string; when?: (params: Record<string, any>) => boolean }>()
  const holds = new Map<string, Promise<void>>()
  const heldLists = new Set<() => void>()
  let files: DownloadFileDto[] = design ? infallFiles() : []
  let listFails = design === 'downloads-fail'
  /** A folder served a page at a time, as the app pages a long listing. */
  let folder: { path: string; entries: FolderEntryDto[]; pageSize: number } | null = null
  const settings: SettingsDto = {
    language, downloadFolder: design ? '/Users/alex/Movies' : '/downloads', postDownloadAction: 'StopSeeding', seedRatio: 1,
    disabledProviders: [], downloadLimit: 0, uploadLimit: 0, altDownloadLimit: 0, altUploadLimit: 0,
    altSpeedMode: 'off', altScheduleFrom: 0, altScheduleTo: 0, altScheduleDays: [], networkInterface: '',
    notifyOnStart: false, notifyOnComplete: false, emailEnabled: false, smtpHost: '', smtpPort: 587,
    smtpUseSsl: false, smtpUsername: '', smtpPasswordSet: false, emailFrom: '', emailTo: '', desktopEnabled: false,
    telegramEnabled: false, telegramBotTokenSet: false, telegramChatId: '', errorReportsEnabled: false, askDownloadFolder: true,
  }
  // The settings screens show the values the design was drawn with.
  const settingsDesign = design === 'settings' || design?.startsWith('set-') === true
  if (settingsDesign) Object.assign(settings, {
    postDownloadAction: 'SeedToRatio', seedRatio: 1.5, uploadLimit: 2_000_000, altDownloadLimit: 1_000_000, altUploadLimit: 500_000,
    altSpeedMode: 'scheduled', altScheduleFrom: 480, altScheduleTo: 1380, altScheduleDays: [0, 1, 2, 3, 4], networkInterface: 'utun4',
    notifyOnComplete: true, emailEnabled: true, smtpHost: 'smtp.example.com', smtpPort: 465, smtpUseSsl: true, emailFrom: 'magnetar@example.com',
    emailTo: 'alex@example.com', telegramEnabled: true, telegramBotTokenSet: true, telegramChatId: '48213377', errorReportsEnabled: true,
    askDownloadFolder: false, disabledProviders: ['EZTV'],
  } satisfies Partial<SettingsDto>)
  let downloads: DownloadDto[] = design ? infallDownloads(design) : []
  let nextId = downloads.length + 1
  const sockets = new Set<WebSocketRoute>()
  const sessions = new Map<WebSocketRoute, E2ESession>()
  const rawKey = new Uint8Array(32).fill(7)
  const key = await importBrowserKey(rawKey)
  const reply = (socket: WebSocketRoute, message: unknown) => {
    const session = sessions.get(socket)
    if (session) void session.seal(message).then(frame => socket.send(Buffer.from(frame)))
    else socket.send(JSON.stringify(message))
  }
  const send = <E extends keyof RpcEvents>(event: E, data: RpcEvents[E]) => {
    for (const socket of sockets) reply(socket, { event, data })
  }
  const replies: Partial<RpcResults> = {
    'app.info': { version: '1.2.1', commit: 'abcdef1', platform: design ? 'macos' : 'linux', arch: 'x64', dataDirectory: '/data', nativeFolderPicker: false, fileBrowser: true },
    'transfer.status': { engine: design === 'held' ? 'waitingForNetwork' : 'running', message: null, networkInterface: design === 'held' ? 'utun4' : null, altSpeedActive: false, downloadLimit: 0, uploadLimit: 0, freeBytes: design ? 137.8e9 : null, diskFull: null },
    'series.list': design === 'watchlist' ? infallSeries() : [], 'watches.list': design === 'watchlist' ? infallWatches : [], 'settings.get': settings, 'sources.list': design ? infallSources : [],
    'updates.status': { currentVersion: '1.2.1', currentCommit: 'abcdef1', available: null, canSelfInstall: false, checking: false, installing: false, lastCheckedAt: null, lastCheckError: null, lastCheckProblem: null, retryAt: null },
    'remote.status': { paired: true, deviceName: name, deviceId: 'test', accountEmail: 'test@example.org', cloudUrl: 'https://example.org', browsers: [], connected: true, pendingPairing: null, lastError: null },
    'legacy.status': { available: false, path: null, imported: false, downloads: 0, seriesTasks: 0 },
    'startup.status': { status: settingsDesign ? 'enabled' : 'unavailable' },
    'startup.set': { status: 'enabled' },
    'fs.roots': design ? infallRoots(language) : { roots: [{ path: '/downloads', kind: 'downloads', available: true, freeBytes: null }], canAdd: true },
    'fs.browse': { path: '/downloads', root: '/downloads', separator: '/', entries: [], offset: 0, total: 0, truncated: false },
  }
  if (settingsDesign) Object.assign(replies, {
    'handlers.status': { status: 'default' },
    'network.interfaces': { supported: true, interfaces: [{ name: 'utun4', addresses: ['10.8.0.2'], vpn: true }, { name: 'en0', addresses: ['192.168.1.20'], vpn: false }] },
    'updates.status': { ...replies['updates.status']!, currentVersion: '1.2.2', currentCommit: '6759fe9', lastCheckedAt: '2026-10-14T20:02:00+02:00' },
    'app.info': { ...replies['app.info']!, version: '1.2.2', commit: '6759fe9', dataDirectory: '/Users/alex/Library/Application Support/Magnetar', arch: 'arm64' },
    'remote.status': { ...replies['remote.status']!, accountEmail: 'alex@example.com', cloudUrl: 'https://magnetar.codefusion.cc', browsers: [
      { keyId: 'phone', label: language === 'pl' ? 'iPhone Alexa' : 'Alex’s iPhone', createdAt: '2026-09-01T10:00:00Z', lastSeenAt: '2026-10-14T20:39:00+02:00' },
      { keyId: 'firefox', label: language === 'pl' ? 'Firefox na MacBook-Pro' : 'Firefox on MacBook-Pro', createdAt: '2026-09-02T10:00:00Z', lastSeenAt: '2026-10-13T18:00:00+02:00' },
    ] },
    'agent.status': { enabled: true, allowRemote: false, token: 'token', mcpUrl: 'http://127.0.0.1:47820/mcp', endpointFile: '/Users/alex/Library/Application Support/Magnetar/endpoint.json' },
    'agent.clients': ([['claudeCode', 'Claude Code', true], ['codex', 'Codex', false], ['cursor', 'Cursor', false]] as const).map(([id, name, connected]) =>
      ({ id, name, installed: true, connected, manual: { kind: 'command' as const, text: `${id} mcp add magnetar` } })),
  } satisfies Partial<RpcResults>)
  await page.route('**/app-config.json', route => route.fulfill({ json: { mode: remote ? 'cloud' : 'local', googleClientId: '', devAuth: false } }))
  await page.route('**/api/releases/latest', route => route.fulfill({ status: 503, body: '' }))
  if (remote) {
    await page.route('**/api/me', route => route.fulfill({ json: { id: 'account', email: 'alex@example.com', name: 'Alex', picture: null } }))
    await page.route('**/api/devices', route => route.fulfill({ json: [{ id: 'test', name, platform: 'macos', version: '1.2.1', online: true, lastSeenAt: null, createdAt: '2026-01-01T00:00:00Z' }] }))
    await seedDeviceKeys(page, [{ deviceId: 'test', keyId: 'testkey' }], [...rawKey])
  }
  await page.routeWebSocket(remote ? '**/api/devices/test/connect' : '**/ws', socket => {
    sockets.add(socket)
    socket.onClose(() => { sockets.delete(socket); sessions.delete(socket) })
    if (remote) socket.send(JSON.stringify({ t: 'device', online: design !== 'loading' }))
    socket.onMessage(async raw => {
      if (raw === 'ping') return
      if (remote && typeof raw !== 'string') {
        const frame = new Uint8Array(raw)
        if (frame[0] === FRAME_HANDSHAKE) {
          const hello = decodeHandshake(frame)
          if (hello.t !== 'hello') return
          const { session, welcome } = await acceptBrowserHandshake(hello, key)
          sessions.set(socket, session)
          socket.send(Buffer.from(encodeHandshake(welcome)))
          return
        }
      }
      const { id, method, params } = remote && typeof raw !== 'string'
        ? await sessions.get(socket)!.open(new Uint8Array(raw)) as { id: number; method: string; params: Record<string, any> }
        : JSON.parse(String(raw))
      calls.push(method)
      log.push({ method, params: params ?? {} })
      const searchNumber = calls.filter(c => c === 'search.start').length
      const held = holds.get(method)
      if (held) { holds.delete(method); await held }
      if (delay && ['downloads.pause', 'downloads.resume', 'downloads.files', 'downloads.selectFiles'].includes(method)) await new Promise(resolve => setTimeout(resolve, delay))
      const failure = failures.get(method)
      if (failure && (!failure.when || failure.when(params ?? {}))) {
        failures.delete(method)
        reply(socket, { id, error: failure })
        return
      }
      if ((method === 'series.list' && design === 'watch-wait') || (method === 'fs.browse' && design === 'files-wait')) return
      if (method === 'series.list' && design === 'watch-fail') { reply(socket, { id, error: { code: 'timeout', message: 'The computer did not answer in time' } }); return }
      if (design && method === 'fs.browse' && String(params.path).startsWith('/Volumes/')) { reply(socket, {id, error:{ code:'not_found', message: language === 'pl' ? 'Dysk może być odłączony od Mac-Mini-M1. Pliki pokażą go znowu, gdy wróci.' : 'It may be unplugged from Mac-Mini-M1. Files shows it again when it is back.' }}); return }
      if (method === 'downloads.list' && design === 'loading') return
      if (method === 'downloads.list' && listFails) {
        listFails = false
        reply(socket, { id, error: { code: 'timeout', message: 'The computer did not answer in time' } })
        return
      }
      let result: unknown
      if (method === 'search.start') {
        result = {searchId: `search${searchNumber}`}
        const searchId = (result as {searchId:string}).searchId
        if (design && !manualSearch) setTimeout(() => {
          const data = infallSearch(design)
          send('search.results', {searchId,results:data.results})
          for (const outcome of data.outcomes) send('search.source', {searchId,outcome})
          if (design !== 'search-wait') send('search.done', {searchId,error:null})
        }, 100)
      } else if (method === 'search.cancel') result = null
      else if (method === 'series.checkNow' || method === 'watches.checkNow') {
        if (delay) await new Promise(resolve => setTimeout(resolve, delay))
        result = {found:false}
      } else if (method === 'fs.browse' && folder && params.path === folder.path) {
        const offset = Number(params.offset ?? 0)
        result = { path: folder.path, root: folder.path, separator: '/', entries: folder.entries.slice(offset, offset + folder.pageSize), offset, total: folder.entries.length, truncated: false }
      } else if (method === 'fs.browse' && design) result = infallFolder(params.path)
      else if (method === 'downloads.list') {
        result = structuredClone(downloads)
        if (holdList) await new Promise<void>(resolve => heldLists.add(resolve))
      }
      else if (method === 'downloads.files') result = files
      else if (method === 'downloads.selectFiles') {
        files = files.map(f => ({ ...f, selected: params.files.includes(f.index) }))
        result = downloads.find(d => d.id === params.id)
      } else if (method === 'downloads.pause' || method === 'downloads.resume') {
        downloads = downloads.map(d => d.id === params.id ? { ...d, status: method === 'downloads.pause' ? 'Paused' : 'Downloading', downloadSpeed: method === 'downloads.pause' ? 0 : 3.4e6 } : d)
        result = null
        send('downloads.changed', downloads)
      } else if (method === 'settings.update') {
        Object.assign(settings, params)
        result = settings
        send('settings.changed', settings)
        const transfer = replies['transfer.status']!
        transfer.altSpeedActive = settings.altSpeedMode === 'on'
        send('transfer.changed', transfer)
      } else if (method === 'downloads.reveal') result = null
      else if (method === 'downloads.start') {
        const magnet = new URL(params.magnet ?? `magnet:?dn=${params.resultId}`)
        const download: DownloadDto = {
          id: nextId++, name: magnet.searchParams.get('dn') ?? 'Download', status: 'FetchingMetadata',
          progress: 0, totalBytes: 0, downloadSpeed: 0, uploadSpeed: 0, peers: 0, source: '', savePath: '/downloads',
          addedAt: '2026-01-01T00:00:00Z', completedAt: null, error: null, seriesTaskId: null, uploadedBytes: 0, partialFiles: null,
        }
        downloads = [...downloads, download]
        result = download
        send('downloads.changed', downloads)
      } else if (method === 'downloads.delete') {
        downloads = downloads.filter(download => download.id !== params.id)
        result = null
        send('downloads.changed', downloads)
      } else if (method in replies) result = replies[method as keyof RpcResults]
      else {
        reply(socket, { id, error: { code: 'unsupported', message: `Unsupported method: ${method}` } })
        return
      }
      reply(socket, { id, result })
    })
  })
  return {
    send,
    calls,
    log,
    holdNext: (method: string) => {
      let release!: () => void
      holds.set(method, new Promise<void>(resolve => { release = resolve }))
      return release
    },
    setReply: <M extends keyof RpcResults>(method: M, result: RpcResults[M]) => { replies[method] = result },
    releaseList: () => { holdList = false; for (const release of heldLists) release(); heldLists.clear() },
    /** The next call of `method` fails; `timeout` reads as a computer that did not answer. */
    /** Fails the next call of `method`, or only the next one whose parameters `when` picks. */
    failNext: (method: string, message: string, code = 'test_failure', when?: (params: Record<string, any>) => boolean) => failures.set(method, { message, code, when }),
    setFiles: (next: DownloadFileDto[]) => { files = next },
    /** Serves `entries` at `path`, `pageSize` at a time by offset. */
    setFolder: (path: string, entries: FolderEntryDto[], pageSize = 100) => { folder = { path, entries, pageSize } },
    /** Replaces the downloads the device lists, before the page asks or with a `downloads.changed` push. */
    setDownloads: (next: DownloadDto[]) => { downloads = next },
    downloads: () => downloads,
    settings: () => settings,
    disconnect: () => {
      for (const socket of sockets) socket.close()
      sockets.clear()
    },
  }
}
