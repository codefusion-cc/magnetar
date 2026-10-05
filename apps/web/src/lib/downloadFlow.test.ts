import { describe, expect, test } from 'vitest'
import { DownloadFlow } from './downloadFlow.ts'

function setup({ ask = false, fail = false } = {}) {
  const calls: { item: string; folder?: string }[] = []
  const log = { started: [] as [string, string | undefined][], failed: [] as unknown[] }
  const gate: { release: () => void } = { release: () => {} }
  let hold = false
  const flow = new DownloadFlow<string>({
    start: async (item, folder) => {
      calls.push({ item, folder })
      if (hold) await new Promise<void>(resolve => { gate.release = resolve })
      if (fail) throw new Error('folder refused')
    },
    ask: () => ask,
    started: (item, folder) => log.started.push([item, folder]),
    failed: e => log.failed.push(e),
    describe: e => (e as Error).message,
  })
  return { flow, calls, log, gate, hold: () => { hold = true } }
}

describe('a Download click', () => {
  test('with the setting off adds to the default folder at once, without a browser', async () => {
    const { flow, calls, log } = setup()
    await flow.request('a')
    expect(calls).toEqual([{ item: 'a', folder: undefined }])
    expect(log.started).toEqual([['a', undefined]])
    expect(flow.state.choosing).toBeNull()
  })

  test('with the setting on opens the browser and adds nothing until Download here, to that folder', async () => {
    const { flow, calls, log } = setup({ ask: true })
    await flow.request('a')
    expect(calls).toEqual([])
    expect(flow.state.choosing).toBe('a')
    await flow.confirm('/Volumes/Media/Films')
    expect(calls).toEqual([{ item: 'a', folder: '/Volumes/Media/Films' }])
    expect(log.started).toEqual([['a', '/Volumes/Media/Films']])
    expect(flow.state).toEqual({ choosing: null, busy: false, error: null })
  })

  test('Download to… opens the browser although the setting is off', async () => {
    const { flow, calls } = setup({ ask: false })
    await flow.request('a', true)
    expect(calls).toEqual([])
    expect(flow.state.choosing).toBe('a')
  })

  test('cancelling adds nothing and closes the browser', async () => {
    const { flow, calls, log } = setup({ ask: true })
    await flow.request('a')
    flow.cancel()
    await flow.confirm('/x')
    expect(flow.state.choosing).toBeNull()
    expect([calls, log.started]).toEqual([[], []])
  })

  test('a double click on Download here adds it once', async () => {
    const { flow, calls, gate, hold } = setup({ ask: true })
    hold()
    await flow.request('a')
    const first = flow.confirm('/x')
    await flow.confirm('/x')
    expect(flow.state.busy).toBe(true)
    gate.release()
    await first
    expect(calls).toHaveLength(1)
  })

  test('a double click on a one-click Download adds it once', async () => {
    const { flow, calls, gate, hold } = setup()
    hold()
    const first = flow.request('a')
    await flow.request('a')
    gate.release()
    await first
    expect(calls).toHaveLength(1)
  })

  test('cannot be cancelled while it is being added', async () => {
    const { flow, gate, hold } = setup({ ask: true })
    hold()
    await flow.request('a')
    const pending = flow.confirm('/x')
    flow.cancel()
    expect(flow.state.choosing).toBe('a')
    gate.release()
    await pending
  })

  test('a refusal stays in the browser, marks nothing added, and a retry works', async () => {
    const { flow, log } = setup({ ask: true, fail: true })
    await flow.request('a')
    await flow.confirm('/x')
    expect(flow.state).toEqual({ choosing: 'a', busy: false, error: 'folder refused' })
    expect(log.started).toEqual([])
    await flow.confirm('/y')
    expect(flow.state.error).toBe('folder refused')
  })

  test('a refusal on the one-click path is reported, not marked added', async () => {
    const { flow, log } = setup({ fail: true })
    await flow.request('a')
    expect(log.failed).toHaveLength(1)
    expect(log.started).toEqual([])
    expect(flow.state.busy).toBe(false)
  })

  test('a blank folder is not a choice', async () => {
    const { flow, calls } = setup({ ask: true })
    await flow.request('a')
    await flow.confirm('  ')
    expect(calls).toEqual([])
  })
})
