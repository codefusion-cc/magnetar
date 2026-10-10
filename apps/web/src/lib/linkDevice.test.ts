import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { bytesToBase64Url } from '@codefusion-cc/workers-crypto'
import { linkWithCode, linkWithKey, type Probe } from './linkDevice.ts'
import { saveDeviceKey } from './keyStore.ts'
import type { ConnectionState } from './rpcClient.ts'

// IndexedDB is an edge of the browser; the key store has its own tests.
vi.mock('./keyStore.ts', () => ({ saveDeviceKey: vi.fn(async () => {}) }))

const raw = Uint8Array.from({ length: 32 }, (_, i) => i + 1)

/** A connection the test moves by hand. */
class FakeProbe implements Probe {
  state: ConnectionState = { status: 'connecting' }
  closed = false
  private handlers = new Set<(state: ConnectionState) => void>()
  onState(handler: (state: ConnectionState) => void) {
    this.handlers.add(handler)
    return () => this.handlers.delete(handler)
  }
  move(state: ConnectionState) {
    this.state = state
    for (const handler of this.handlers) handler(state)
  }
  close() { this.closed = true }
  get listeners() { return this.handlers.size }
}

let probes: FakeProbe[]
const connect = () => {
  const probe = new FakeProbe()
  probes.push(probe)
  return probe
}
const tick = () => vi.advanceTimersByTimeAsync(0)

beforeEach(() => {
  probes = []
  vi.useFakeTimers()
  vi.mocked(saveDeviceKey).mockReset().mockResolvedValue(undefined)
})
afterEach(() => vi.useRealTimers())

describe('linking with a key', () => {
  test('stores the key once the device has accepted it, and lets the connection go', async () => {
    const result = linkWithKey('dev1', 'key1', raw, { connect })
    await tick()
    expect(saveDeviceKey).not.toHaveBeenCalled()
    probes[0]!.move({ status: 'open' })
    await expect(result).resolves.toBe('linked')
    expect(saveDeviceKey).toHaveBeenCalledExactlyOnceWith('dev1', 'key1', raw)
    expect(probes[0]!.closed).toBe(true)
    expect(probes[0]!.listeners).toBe(0)
  })

  test('a connection that is open already is linked', async () => {
    const result = linkWithKey('dev1', 'key1', raw, { connect: () => Object.assign(connect(), { state: { status: 'open' } as ConnectionState }) })
    await expect(result).resolves.toBe('linked')
  })

  test.each([
    [{ status: 'rejected', reason: 'remote.rejectedKey' }, 'wrong'],
    [{ status: 'rejected', reason: 'remote.rejectedRefused' }, 'failed'],
    [{ status: 'rejected', reason: 'remote.removed' }, 'removed'],
    [{ status: 'rejected', reason: 'remote.signedOut' }, 'signed-out'],
    [{ status: 'rejected', reason: 'remote.handshakeFailed' }, 'failed'],
    [{ status: 'device-offline' }, 'device-offline'],
    [{ status: 'closed' }, 'failed'],
  ] as const)('%j ends as %s and stores nothing', async (state, expected) => {
    const result = linkWithKey('dev1', 'key1', raw, { connect })
    await tick()
    probes[0]!.move(state)
    await expect(result).resolves.toBe(expected)
    expect(saveDeviceKey).not.toHaveBeenCalled()
    expect(probes[0]!.closed).toBe(true)
  })

  test('a device that never answers is slow after the time, and nothing is stored', async () => {
    const result = linkWithKey('dev1', 'key1', raw, { connect, timeoutMs: 15_000 })
    await tick()
    await vi.advanceTimersByTimeAsync(14_999)
    probes[0]!.move({ status: 'connecting' })
    await vi.advanceTimersByTimeAsync(1)
    await expect(result).resolves.toBe('slow')
    expect(saveDeviceKey).not.toHaveBeenCalled()
    expect(probes[0]!.closed).toBe(true)
  })

  test('a connection that keeps dropping is a network problem, not a slow device', async () => {
    const result = linkWithKey('dev1', 'key1', raw, { connect, timeoutMs: 5_000 })
    await tick()
    probes[0]!.move({ status: 'reconnecting' })
    await vi.advanceTimersByTimeAsync(5_000)
    await expect(result).resolves.toBe('network')
  })

  test('without a network it does not even connect', async () => {
    await expect(linkWithKey('dev1', 'key1', raw, { connect, online: () => false })).resolves.toBe('network')
    expect(probes).toHaveLength(0)
  })

  test('a double tap is one try: one connection, one stored key, the same answer', async () => {
    const first = linkWithKey('dev1', 'key1', raw, { connect })
    const second = linkWithKey('dev1', 'key1', raw, { connect })
    await tick()
    expect(probes).toHaveLength(1)
    probes[0]!.move({ status: 'open' })
    await expect(Promise.all([first, second])).resolves.toEqual(['linked', 'linked'])
    expect(saveDeviceKey).toHaveBeenCalledTimes(1)
    // Once it has ended, a new try is a new connection.
    const again = linkWithKey('dev1', 'key1', raw, { connect })
    await tick()
    expect(probes).toHaveLength(2)
    probes[1]!.move({ status: 'device-offline' })
    await expect(again).resolves.toBe('device-offline')
  })

  test('another key or another device is another try', async () => {
    const a = linkWithKey('dev1', 'key1', raw, { connect })
    const b = linkWithKey('dev1', 'key2', raw, { connect })
    const c = linkWithKey('dev2', 'key1', raw, { connect })
    await tick()
    expect(probes).toHaveLength(3)
    probes.forEach(p => p.move({ status: 'open' }))
    await Promise.all([a, b, c])
    expect(saveDeviceKey).toHaveBeenCalledTimes(3)
  })

  test('a key the browser cannot keep is said so, though the device accepted it', async () => {
    vi.mocked(saveDeviceKey).mockRejectedValue(new Error('disk full'))
    const result = linkWithKey('dev1', 'key1', raw, { connect })
    await tick()
    probes[0]!.move({ status: 'open' })
    await expect(result).resolves.toBe('storage')
  })

  test('a key that is not 32 bytes is a failure, not a throw', async () => {
    await expect(linkWithKey('dev1', 'key1', new Uint8Array(5) as Uint8Array<ArrayBuffer>, { connect })).resolves.toBe('failed')
    expect(probes).toHaveLength(0)
  })

  test('a connection that cannot be made is a failure, not a throw', async () => {
    await expect(linkWithKey('dev1', 'key1', raw, { connect: () => { throw new Error('no WebSocket') } })).resolves.toBe('failed')
  })
})

describe('linking with a typed code', () => {
  test('connects with the key the code stands for and stores that one', async () => {
    // The first of the vectors the device's derivation is checked against (link-code-vector.json).
    const result = linkWithCode('dev1', '00000000000000000000', { connect: (deviceId, key) => {
      expect([deviceId, key.keyId]).toEqual(['dev1', 'oL8HlP_J3807'])
      return connect()
    } })
    await vi.waitFor(() => expect(probes).toHaveLength(1))
    probes[0]!.move({ status: 'open' })
    await expect(result).resolves.toBe('linked')
    expect(saveDeviceKey).toHaveBeenCalledOnce()
    const [deviceId, keyId, key] = vi.mocked(saveDeviceKey).mock.calls[0]!
    expect([deviceId, keyId, bytesToBase64Url(key)]).toEqual(['dev1', 'oL8HlP_J3807', 'b_ou7b_LQ5n6lLM_OM_2dPsq5d8QtHt0bk0yzQI2maY'])
  })

  test('a code the device refuses stores nothing', async () => {
    const result = linkWithCode('dev1', '00000000000000000000', { connect })
    await vi.waitFor(() => expect(probes).toHaveLength(1))
    probes[0]!.move({ status: 'rejected', reason: 'remote.rejectedKey' } as ConnectionState)
    await expect(result).resolves.toBe('wrong')
    expect(saveDeviceKey).not.toHaveBeenCalled()
  })

  test('a browser that cannot derive the key fails without connecting, and does not throw', async () => {
    const importKey = vi.spyOn(crypto.subtle, 'importKey').mockRejectedValueOnce(new DOMException('no', 'NotSupportedError'))
    await expect(linkWithCode('dev1', '00000000000000000000', { connect })).resolves.toBe('failed')
    expect(probes).toHaveLength(0)
    importKey.mockRestore()
  })
})
