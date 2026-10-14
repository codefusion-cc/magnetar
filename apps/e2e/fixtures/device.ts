import type { DownloadDto, RpcEvents, RpcResults, SettingsDto } from '@magnetar/protocol'
import type { Page, WebSocketRoute } from '@playwright/test'

/** A device at the network boundary; the dashboard, transport and subscriptions stay real. */
export async function serveDevice(page: Page, { name = 'Test computer', language = 'en' } = {}) {
  const settings: SettingsDto = {
    language, downloadFolder: '/downloads', postDownloadAction: 'StopSeeding', seedRatio: 1,
    disabledProviders: [], downloadLimit: 0, uploadLimit: 0, altDownloadLimit: 0, altUploadLimit: 0,
    altSpeedMode: 'off', altScheduleFrom: 0, altScheduleTo: 0, altScheduleDays: [], networkInterface: '',
    notifyOnStart: false, notifyOnComplete: false, emailEnabled: false, smtpHost: '', smtpPort: 587,
    smtpUseSsl: false, smtpUsername: '', smtpPasswordSet: false, emailFrom: '', emailTo: '', desktopEnabled: false,
    telegramEnabled: false, telegramBotTokenSet: false, telegramChatId: '', errorReportsEnabled: false, askDownloadFolder: true,
  }
  let downloads: DownloadDto[] = []
  let nextId = 1
  const sockets = new Set<WebSocketRoute>()
  const send = <E extends keyof RpcEvents>(event: E, data: RpcEvents[E]) => {
    for (const socket of sockets) socket.send(JSON.stringify({ event, data }))
  }
  const replies: Partial<RpcResults> = {
    'app.info': { version: '1.2.1', commit: 'abcdef1', platform: 'linux', arch: 'x64', dataDirectory: '/data', nativeFolderPicker: false, fileBrowser: true },
    'series.list': [], 'watches.list': [], 'settings.get': settings, 'sources.list': [],
    'updates.status': { currentVersion: '1.2.1', currentCommit: 'abcdef1', available: null, canSelfInstall: false, checking: false, installing: false, lastCheckedAt: null, lastCheckError: null, lastCheckProblem: null, retryAt: null },
    'remote.status': { paired: true, deviceName: name, deviceId: 'test', accountEmail: 'test@example.org', cloudUrl: 'https://example.org', browsers: [], connected: true, pendingPairing: null, lastError: null },
    'legacy.status': { available: false, path: null, imported: false, downloads: 0, seriesTasks: 0 },
    'startup.status': { status: 'unavailable' },
    'fs.roots': { roots: [{ path: '/downloads', kind: 'downloads', available: true, freeBytes: null }], canAdd: true },
    'fs.browse': { path: '/downloads', root: '/downloads', separator: '/', entries: [], offset: 0, total: 0, truncated: false },
  }
  await page.route('**/app-config.json', route => route.fulfill({ json: { mode: 'local' } }))
  await page.route('**/api/releases/latest', route => route.fulfill({ status: 503, body: '' }))
  await page.routeWebSocket('**/ws', socket => {
    sockets.add(socket)
    socket.onClose(() => sockets.delete(socket))
    socket.onMessage(raw => {
      const { id, method, params } = JSON.parse(String(raw))
      let result: unknown
      if (method === 'downloads.list') result = downloads
      else if (method === 'downloads.start') {
        const magnet = new URL(params.magnet)
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
        socket.send(JSON.stringify({ id, error: { code: 'unsupported', message: `Unsupported method: ${method}` } }))
        return
      }
      socket.send(JSON.stringify({ id, result }))
    })
  })
  return {
    send,
    downloads: () => downloads,
    disconnect: () => {
      for (const socket of sockets) socket.close()
      sockets.clear()
    },
  }
}
