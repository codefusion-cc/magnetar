import { describe, expect, test } from 'vitest'
import { DownloadFlow, askingWhere } from './downloadFlow.ts'

function setup({ ask = false, fail = false, failRemember = false } = {}) {
  const calls: { item: string; folder?: string }[] = []
  const patches: string[] = []
  const log = { started: [] as [string, string | undefined][], outcomes: [] as unknown[], failed: [] as unknown[] }
  const gate: { release: () => void } = { release: () => {} }
  let hold = false
  const flow = new DownloadFlow<string>({
    start: async (item, folder) => {
      calls.push({ item, folder })
      if (hold) await new Promise<void>(resolve => { gate.release = resolve })
      if (fail) throw new Error('folder refused')
    },
    ask: () => ask,
    remember: async folder => {
      patches.push(folder)
      if (failRemember) throw new Error('settings refused')
    },
    started: (item, folder, always) => {
      log.started.push([item, folder])
      log.outcomes.push(always)
    },
    failed: e => log.failed.push(e),
    describe: e => (e as Error).message,
  })
  return { flow, calls, patches, log, gate, hold: () => { hold = true } }
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

  test('"always save here" adds first, then saves the folder as the default once', async () => {
    const { flow, calls, patches, log } = setup({ ask: true })
    await flow.request('a')
    await flow.confirm('/Volumes/Media/Films', true)
    expect(calls).toEqual([{ item: 'a', folder: '/Volumes/Media/Films' }])
    expect(patches).toEqual(['/Volumes/Media/Films'])
    expect(log.outcomes).toEqual([{ saved: true }])
  })

  test('without the box ticked no setting is saved', async () => {
    const { flow, patches, log } = setup({ ask: true })
    await flow.request('a')
    await flow.confirm('/x')
    expect(patches).toEqual([])
    expect(log.outcomes).toEqual([undefined])
  })

  test('when the download is refused no setting is saved', async () => {
    const { flow, patches } = setup({ ask: true, fail: true })
    await flow.request('a')
    await flow.confirm('/x', true)
    expect(patches).toEqual([])
    expect(flow.state.error).toBe('folder refused')
  })

  test('when the settings are refused the download stays added and the refusal is told', async () => {
    const { flow, calls, log } = setup({ ask: true, failRemember: true })
    await flow.request('a')
    await flow.confirm('/x', true)
    expect(calls).toHaveLength(1)
    expect(log.started).toEqual([['a', '/x']])
    expect(log.outcomes).toEqual([{ saved: false, error: 'settings refused' }])
    expect(flow.state).toEqual({ choosing: null, busy: false, error: null })
  })

  test('a double click on Download here with the box ticked adds once and saves once', async () => {
    const { flow, calls, patches, gate, hold } = setup({ ask: true })
    hold()
    await flow.request('a')
    const first = flow.confirm('/x', true)
    await flow.confirm('/x', true)
    gate.release()
    await first
    expect([calls.length, patches.length]).toEqual([1, 1])
  })
})

describe('what the device says about asking where to save', () => {
  test('a setting that is on or off is followed, and "always save here" is offered', () => {
    expect(askingWhere({ askDownloadFolder: true })).toEqual({ ask: true, canRemember: true })
    expect(askingWhere({ askDownloadFolder: false })).toEqual({ ask: false, canRemember: true })
  })

  test('an older app without the setting asks, and cannot be told to stop (it would refuse the whole patch)', () => {
    expect(askingWhere({})).toEqual({ ask: true, canRemember: false })
  })

  test('settings not loaded yet change nothing and offer nothing', () => {
    expect(askingWhere(undefined)).toEqual({ ask: false, canRemember: false })
    expect(askingWhere(null)).toEqual({ ask: false, canRemember: false })
  })
})
