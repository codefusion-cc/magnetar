import type { Page } from '@playwright/test'
import type { CloudDeviceDto } from '@magnetar/protocol/cloud'
import { acceptBrowserHandshake, decodeHandshake, encodeHandshake, FRAME_HANDSHAKE, importBrowserKey } from '@magnetar/protocol/e2e'
import { linkCodeKey } from '@magnetar/protocol/link-code'
import { seedDeviceKeys } from './keys.ts'

/** The code each fake computer accepts from a browser linking itself; any other is refused as the relay does. */
export const LINK_CODE = '7K2QM-4XPDR-9TBVN-3HWJC'

export const COMPUTERS: CloudDeviceDto[] = [
  { id: 'mini', name: 'Mac-Mini-M1', platform: 'macos', version: '1.2.2', online: true, lastSeenAt: null, createdAt: '2026-01-01T00:00:00Z' },
  { id: 'mbp', name: 'MacBook-Pro', platform: 'macos', version: '1.2.2', online: true, lastSeenAt: null, createdAt: '2026-02-01T00:00:00Z' },
  { id: 'pc', name: 'Living-Room-PC', platform: 'windows', version: '1.1.0', online: false, lastSeenAt: '2026-10-13T21:10:00Z', createdAt: '2026-03-01T00:00:00Z' },
]

/**
 * The website at its network edge: who is signed in, the account's computers (or a list that fails or never comes),
 * the newest release, and the relay for linking a browser by code. Every page and the browser's key store stay real.
 */
export async function serveWebsite(page: Page, { signedIn = true, devices = COMPUTERS, linked = ['mini', 'pc'], devicesFail = 0, holdDevices = false }: {
  signedIn?: boolean
  devices?: CloudDeviceDto[]
  /** Computers this browser already holds a key for. */
  linked?: string[]
  /** How many reads of the list fail before one answers. */
  devicesFail?: number
  holdDevices?: boolean
} = {}) {
  let deviceReads = 0
  let logouts = 0
  const removed: string[] = []
  let failing = devicesFail
  /** From now on every read of the list answers with this status (503: the website is down; 401: signed out). */
  let failWith: number | null = null
  await page.route('**/app-config.json', route => route.fulfill({ json: { mode: 'cloud', googleClientId: 'test-client', devAuth: false } }))
  await page.route('**/api/releases/latest', route => route.fulfill({ json: {
    version: '1.2.2', publishedAt: '2026-10-10T10:00:00Z', pageUrl: 'https://github.com/codefusion-cc/magnetar/releases/tag/v1.2.2',
    assets: [
      { name: 'Magnetar-macos-arm64.zip', platform: 'macos', arch: 'arm64', size: 8_300_000, url: 'https://example.org/Magnetar-macos-arm64.zip' },
      { name: 'Magnetar-windows-x64.exe', platform: 'windows', arch: 'x64', size: 9_100_000, url: 'https://example.org/Magnetar-windows-x64.exe' },
      { name: 'Magnetar-linux-x64', platform: 'linux', arch: 'x64', size: 9_400_000, url: 'https://example.org/Magnetar-linux-x64' },
    ],
  } }))
  await page.route('**/api/me', route => signedIn
    ? route.fulfill({ json: { id: 'account', email: 'alex@example.com', name: 'Alex', picture: null } })
    : route.fulfill({ status: 401, json: { error: 'Not signed in' } }))
  await page.route('**/api/devices', async route => {
    deviceReads++
    if (holdDevices) return
    if (failing > 0) { failing--; return route.fulfill({ status: 503, json: { error: 'Unavailable' } }) }
    if (failWith) return route.fulfill({ status: failWith, json: { error: failWith === 401 ? 'Not signed in' : 'Unavailable' } })
    await route.fulfill({ json: devices.filter(d => !removed.includes(d.id)) })
  })
  await page.route(/\/api\/devices\/[^/]+$/, async route => {
    if (route.request().method() !== 'DELETE') return route.fallback()
    removed.push(decodeURIComponent(route.request().url().split('/').pop()!))
    await route.fulfill({ status: 204, body: '' })
  })
  await page.route('**/api/auth/logout', async route => {
    logouts++
    // Slow enough for a second click to land while the first is on its way.
    await new Promise(resolve => setTimeout(resolve, 300))
    signedIn = false
    await route.fulfill({ status: 204, body: '' })
  })
  await seedDeviceKeys(page, linked.map(deviceId => ({ deviceId, keyId: `key-${deviceId}` })), Array.from({ length: 32 }, () => 7))
  const accepted = await linkCodeKey(LINK_CODE.replaceAll('-', ''))
  const acceptedKey = await importBrowserKey(accepted.key)
  await page.routeWebSocket(/\/api\/devices\/[^/]+\/connect/, socket => {
    socket.send(JSON.stringify({ t: 'device', online: true }))
    socket.onMessage(async raw => {
      if (typeof raw === 'string' || new Uint8Array(raw)[0] !== FRAME_HANDSHAKE) return
      const hello = decodeHandshake(new Uint8Array(raw))
      if (hello.t !== 'hello') return
      if (hello.kid !== accepted.keyId) return socket.send(Buffer.from(encodeHandshake({ t: 'reject', reason: 'unknown-key' })))
      const { welcome } = await acceptBrowserHandshake(hello, acceptedKey)
      socket.send(Buffer.from(encodeHandshake(welcome)))
    })
  })
  return {
    get deviceReads() { return deviceReads },
    get logouts() { return logouts },
    removed,
    failDevices: (status: number) => { failWith = status },
    signOutElsewhere: () => { signedIn = false },
  }
}
