import type { CloudDeviceDto } from '@magnetar/protocol/cloud'
import { afterEach, expect, test, vi } from 'vitest'
import { cloud } from './cloudApi.ts'

const device = (id: string) => ({ id, name: id }) as unknown as CloudDeviceDto

/** A server whose device list answers only when told to, each request on its own; DELETE answers at once. */
function server(list: () => CloudDeviceDto[]) {
  const pending: (() => void)[] = []
  const fetch = vi.fn((_path: string, init?: RequestInit) => {
    if (init?.method === 'DELETE') return Promise.resolve(new Response(null, { status: 204 }))
    const answer = list()
    return new Promise<Response>(resolve => pending.push(() => resolve(Response.json(answer))))
  })
  vi.stubGlobal('fetch', fetch)
  return { fetch, answerNext: () => pending.shift()!() }
}

afterEach(() => vi.unstubAllGlobals())

test('a list asked for before a removal, answered after it, does not bring the computer back', async () => {
  let devices = [device('a'), device('b')]
  const { answerNext } = server(() => devices)
  const before = cloud.devices()
  await cloud.removeDevice('a')
  devices = [device('b')]
  answerNext()
  // The answer from before the removal is read again; the second answer is after it.
  await vi.waitFor(answerNext)
  expect((await before).map(d => d.id)).toEqual(['b'])
  expect(cloud.knownDevices()?.map(d => d.id)).toEqual(['b'])
})

test('a list asked for after a removal does not join the one under way before it', async () => {
  let devices = [device('a'), device('b')]
  const { fetch, answerNext } = server(() => devices)
  const before = cloud.devices()
  await cloud.removeDevice('a')
  devices = [device('b')]
  const after = cloud.devices()
  expect(fetch.mock.calls.filter(([, init]) => init?.method !== 'DELETE')).toHaveLength(2)
  answerNext()
  answerNext()
  expect((await after).map(d => d.id)).toEqual(['b'])
  // The one from before the removal takes the answer after it.
  expect((await before).map(d => d.id)).toEqual(['b'])
})

test('callers at the same moment share one request', async () => {
  const { fetch, answerNext } = server(() => [device('a')])
  const one = cloud.devices()
  const two = cloud.devices()
  answerNext()
  expect(await one).toEqual(await two)
  expect(fetch).toHaveBeenCalledTimes(1)
})
