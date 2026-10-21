import { describe, expect, it } from 'vitest'
import { issueTitle, parseReport, plan, sync, type SourceCheck } from './provider-issues.ts'

const run = { url: 'https://github.com/o/r/actions/runs/7', date: '2026-10-22' }

describe('the provider report', () => {
  it('is read as the live test writes it', () => {
    expect(parseReport('[{"source":"Nyaa","error":null},{"source":"RARBG","error":"HTTP 403 from therarbg.to"}]'))
      .toEqual([{ source: 'Nyaa', error: null }, { source: 'RARBG', error: 'HTTP 403 from therarbg.to' }])
  })

  it.each([
    ['empty', '[]'],
    ['not a list', '{"source":"Nyaa","error":null}'],
    ['a source without a name', '[{"source":" ","error":null}]'],
    ['an error that is not text', '[{"source":"Nyaa","error":403}]'],
    ['a missing error', '[{"source":"Nyaa"}]'],
    ['null', 'null'],
  ])('is refused when %s', (_, json) => {
    expect(() => parseReport(json)).toThrow('not a list of { source, error }')
  })

  it('is refused when cut off', () => {
    expect(() => parseReport('[{"source":"Nyaa","err')).toThrow(SyntaxError)
  })
})

describe('the plan', () => {
  const failing: SourceCheck = { source: 'RARBG', error: 'HTTP 403 from therarbg.to' }

  it('opens one issue for a source failing for the first time, naming it and its error', () => {
    const steps = plan([{ source: 'Nyaa', error: null }, failing], [], run)
    expect(steps).toHaveLength(1)
    expect(steps[0]).toMatchObject({ kind: 'open', title: 'Search source down: RARBG' })
    const body = (steps[0] as { body: string }).body
    expect(body).toContain('```\nHTTP 403 from therarbg.to\n```')
    expect(body).toContain(`Last failed 2026-10-22: ${run.url}`)
  })

  it('updates the open issue while the source keeps failing, never opening a second', () => {
    const steps = plan([failing], [{ number: 12, title: issueTitle('RARBG') }], run)
    expect(steps.map(s => [s.kind, 'number' in s ? s.number : null])).toEqual([['update', 12]])
  })

  it('closes the issue the day the source answers again', () => {
    expect(plan([{ source: 'RARBG', error: null }], [{ number: 12, title: issueTitle('RARBG') }], run))
      .toEqual([{ kind: 'close', number: 12, comment: `RARBG answers again (2026-10-22): ${run.url}` }])
  })

  it('closes the issue of a source no longer searched', () => {
    expect(plan([{ source: 'Knaben', error: null }], [{ number: 3, title: issueTitle('1337x') }], run))
      .toEqual([{ kind: 'close', number: 3, comment: '1337x is no longer searched.' }])
  })

  it('leaves alone issues it did not open', () => {
    const open = [{ number: 5, title: 'RARBG is slow' }, { number: 6, title: 'search source down: RARBG' }]
    expect(plan([{ source: 'RARBG', error: null }], open, run)).toEqual([])
    expect(plan([failing], open, run).map(s => s.kind)).toEqual(['open'])
  })

  it('handles every source failing at once, and names with unicode and spaces', () => {
    const report = [{ source: 'The Pirate Bay', error: 'timed out' }, { source: 'Torrents-CSV ✓', error: 'no results' }]
    expect(plan(report, [], run).map(s => s.kind === 'open' && s.title)).toEqual(['Search source down: The Pirate Bay', 'Search source down: Torrents-CSV ✓'])
  })
})

/** A GitHub that answers each request with the next of `answers`, recording what it was asked. */
function fakeGitHub(answers: (Response | Error)[]) {
  const calls: { method: string; url: string; body: unknown }[] = []
  const fetcher = (async (url: string, init: RequestInit) => {
    calls.push({ method: init.method ?? 'GET', url, body: init.body ? JSON.parse(init.body as string) : undefined })
    const next = answers.shift()
    if (!next) throw new Error(`unexpected ${init.method} ${url}`)
    if (next instanceof Error) throw next
    return next
  }) as typeof fetch
  return { calls, fetcher }
}
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
const options = (fetcher: typeof fetch) => ({ repo: 'o/r', token: 't', run, fetch: fetcher, waitMs: 0 })

describe('syncing with GitHub', () => {
  it('opens, updates and closes in one run, skipping pull requests', async () => {
    const { calls, fetcher } = fakeGitHub([
      json([{ number: 1, title: issueTitle('EZTV') }, { number: 2, title: issueTitle('Nyaa') }, { number: 9, title: issueTitle('RARBG'), pull_request: {} }]),
      json({}), json({}, 201), json({}, 201), json({}),
    ])
    await sync([{ source: 'EZTV', error: 'timed out' }, { source: 'Nyaa', error: null }, { source: 'RARBG', error: 'HTTP 403' }], options(fetcher))
    expect(calls.map(c => `${c.method} ${c.url.replace('https://api.github.com/repos/o/r', '')}`)).toEqual([
      'GET /issues?state=open&creator=github-actions%5Bbot%5D&per_page=100&page=1',
      'PATCH /issues/1',
      'POST /issues',
      'POST /issues/2/comments',
      'PATCH /issues/2',
    ])
    expect(calls[2]!.body).toMatchObject({ title: 'Search source down: RARBG' })
    expect(calls[4]!.body).toEqual({ state: 'closed', state_reason: 'completed' })
  })

  it('reads every page of open issues', async () => {
    const full = Array.from({ length: 100 }, (_, i) => ({ number: i + 100, title: `Other ${i}` }))
    const { calls, fetcher } = fakeGitHub([json(full), json([{ number: 7, title: issueTitle('EZTV') }]), json({}, 201), json({})])
    await sync([{ source: 'EZTV', error: null }], options(fetcher))
    expect(calls.map(c => c.url.match(/page=(\d+)$/)?.[1] ?? c.method)).toEqual(['1', '2', 'POST', 'PATCH'])
  })

  it('tries again after 429, 5xx and a dropped connection', async () => {
    const { calls, fetcher } = fakeGitHub([
      new Response('slow down', { status: 429 }), new Response('', { status: 502 }), new TypeError('fetch failed'), json([]),
      new Response('', { status: 503 }), json({}, 201),
    ])
    expect(await sync([{ source: 'EZTV', error: 'timed out' }], options(fetcher))).toHaveLength(1)
    expect(calls.map(c => c.method)).toEqual(['GET', 'GET', 'GET', 'GET', 'POST', 'POST'])
  })

  it('gives up after four failed tries, saying why', async () => {
    const { fetcher } = fakeGitHub(Array.from({ length: 4 }, () => new Response('', { status: 500 })))
    await expect(sync([{ source: 'EZTV', error: null }], options(fetcher))).rejects.toThrow('GitHub answered 500 to GET')
  })

  it('stops at once on an answer that a retry cannot change, as a token without issues: write', async () => {
    const { calls, fetcher } = fakeGitHub([json([]), new Response('Resource not accessible by integration', { status: 403 })])
    await expect(sync([{ source: 'EZTV', error: 'timed out' }], options(fetcher))).rejects.toThrow('403 to POST /repos/o/r/issues: Resource not accessible')
    expect(calls).toHaveLength(2)
  })

  it('changes nothing when every source answers and no issue is open', async () => {
    const { calls, fetcher } = fakeGitHub([json([])])
    expect(await sync([{ source: 'EZTV', error: null }], options(fetcher))).toEqual([])
    expect(calls).toHaveLength(1)
  })
})
