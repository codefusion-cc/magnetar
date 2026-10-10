import { importBrowserKey } from '@magnetar/protocol/e2e'
import { saveDeviceKey, type StoredDeviceKey } from './keyStore.ts'
import { RelayConnection } from './relayConnection.ts'
import type { ConnectionState } from './rpcClient.ts'

/** How a try at linking this browser to a device ended. */
export type LinkResult =
  /** The device accepted the key and this browser stored it. */
  | 'linked'
  /** The device does not know the key: mistyped, expired, or already used by another browser. */
  | 'wrong'
  | 'device-offline'
  /** The socket to the website would not open, or dropped. */
  | 'network'
  /** Connected, but no answer in time. */
  | 'slow'
  | 'removed'
  | 'signed-out'
  | 'failed'
  /** The device accepted the key, but this browser could not keep it. */
  | 'storage'

type Settled = Exclude<LinkResult, 'storage'>

const FINAL: Record<string, Settled> = {
  'remote.rejectedKey': 'wrong',
  'remote.removed': 'removed',
  'remote.signedOut': 'signed-out',
}

/** What `linkWithKey` needs of a connection; a `RelayConnection` is one. */
export interface Probe {
  state: ConnectionState
  onState(handler: (state: ConnectionState) => void): () => void
  close(): void
}

interface Options {
  timeoutMs?: number
  /** Opens the connection that proves the key; the relay's by default. */
  connect?: (deviceId: string, key: StoredDeviceKey) => Probe
  online?: () => boolean
}

const inFlight = new Map<string, Promise<LinkResult>>()

/**
 * Links this browser to `deviceId` with a key the device made for it: connects once with the key, and stores it only
 * if the device accepted it, so a mistyped code leaves nothing behind. The same key tried twice at once is one try
 * (a double tap links once). The device counts the connection as the key's first use, which is what spends a link.
 * Never throws; the result says what happened.
 */
export function linkWithKey(deviceId: string, keyId: string, raw: Uint8Array<ArrayBuffer>, options: Options = {}): Promise<LinkResult> {
  const id = `${deviceId}\n${keyId}`
  const running = inFlight.get(id)
  if (running) return running
  const attempt = attemptLink(deviceId, keyId, raw, options).finally(() => inFlight.delete(id))
  inFlight.set(id, attempt)
  return attempt
}

async function attemptLink(deviceId: string, keyId: string, raw: Uint8Array<ArrayBuffer>, options: Options): Promise<LinkResult> {
  const { timeoutMs = 15_000, connect = (id, key) => new RelayConnection(id, key), online = () => navigator.onLine !== false } = options
  if (!online()) return 'network'
  let probe: Probe
  try {
    const key = await importBrowserKey(raw)
    probe = connect(deviceId, { deviceId, keyId, key, linkedAt: new Date().toISOString() })
  } catch {
    return 'failed'
  }
  const outcome = await new Promise<Settled>(resolve => {
    let last = probe.state
    let timer: ReturnType<typeof setTimeout> | undefined
    const off = probe.onState(state => settle(state))
    const settle = (state: ConnectionState): void => {
      last = state
      const done: Settled | null = state.status === 'open' ? 'linked'
        : state.status === 'device-offline' ? 'device-offline'
          : state.status === 'rejected' ? (FINAL[state.reason] ?? 'failed')
            : state.status === 'closed' ? 'failed' : null
      if (!done) return
      clearTimeout(timer)
      off()
      resolve(done)
    }
    timer = setTimeout(() => {
      off()
      resolve(last.status === 'reconnecting' ? 'network' : 'slow')
    }, timeoutMs)
    settle(probe.state)
  })
  probe.close()
  if (outcome !== 'linked') return outcome
  try {
    await saveDeviceKey(deviceId, keyId, raw)
    return 'linked'
  } catch {
    return 'storage'
  }
}
