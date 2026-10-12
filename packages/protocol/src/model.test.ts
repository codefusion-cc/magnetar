import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { EPISODES_PAGE_MAX, MAX_CHECK_INTERVAL_MINUTES, MIN_WATCH_INTERVAL_MINUTES, SeriesEpisodesDto, SeriesTaskInput, SeriesTaskPatch, WatchInput } from './model.ts'
import { RPC_PARAMS } from './rpc.ts'
import vector from './series-episodes-vector.json'

const accepts = (schema: { safeParse: (v: unknown) => { success: boolean } }, value: unknown) => schema.safeParse(value).success

describe('check intervals', () => {
  const series = (checkIntervalMinutes: unknown) => ({ name: 'Show', query: 'Show', checkIntervalMinutes })

  test('a series rule checks every minute to once a week', () => {
    for (const minutes of [1, 60, 10_080]) {
      expect(accepts(SeriesTaskInput, series(minutes)), `${minutes}`).toBe(true)
      expect(accepts(SeriesTaskPatch, { checkIntervalMinutes: minutes }), `${minutes}`).toBe(true)
    }
    for (const minutes of [0, -1, 10_081, 1e15, Number.MAX_SAFE_INTEGER, 1.5, Number.NaN, Infinity, '60']) {
      expect(accepts(SeriesTaskInput, series(minutes)), `${minutes}`).toBe(false)
      expect(accepts(SeriesTaskPatch, { checkIntervalMinutes: minutes }), `${minutes}`).toBe(false)
    }
    expect(SeriesTaskInput.parse({ name: 'Show', query: 'Show' }).checkIntervalMinutes).toBe(60)
  })

  test('a watch checks every fifteen minutes to once a week', () => {
    for (const minutes of [15, 10_080]) expect(accepts(WatchInput, { query: 'Show', checkIntervalMinutes: minutes })).toBe(true)
    for (const minutes of [14, 10_081, 1e15]) expect(accepts(WatchInput, { query: 'Show', checkIntervalMinutes: minutes })).toBe(false)
  })

  test('the limits are the app’s own', () => {
    const rust = readFileSync(new URL('../../../apps/client/src/protocol/model.rs', import.meta.url), 'utf8')
    const constant = (name: string) => Number(new RegExp(`pub const ${name}: i64 = ([0-9_]+);`).exec(rust)?.[1]?.replaceAll('_', ''))
    expect(constant('MAX_CHECK_INTERVAL_MINUTES')).toBe(MAX_CHECK_INTERVAL_MINUTES)
    expect(constant('MIN_WATCH_INTERVAL_MINUTES')).toBe(MIN_WATCH_INTERVAL_MINUTES)
  })
})

describe('series episodes', () => {
  const rust = (path: string) => readFileSync(new URL(`../../../apps/client/src/${path}`, import.meta.url), 'utf8')
  const episode = (fields: Record<string, unknown>) => ({ number: 1, name: null, airstamp: null, state: 'expected', ...fields })
  const page = (episodes: unknown[]) => ({ total: episodes.length, offset: 0, episodes, version: '3f9a0c71d2e4b856', airDatesCheckedAt: null })

  test('what the app writes is what the dashboard reads', () => {
    // apps/client/src/protocol/model.rs writes this file's list and checks it is the same.
    expect(SeriesEpisodesDto.parse(vector)).toEqual(vector)
    expect(rust('protocol/model.rs')).toContain('series-episodes-vector.json')
    expect(new Set(vector.episodes.map(e => e.state))).toEqual(new Set(['have', 'downloading', 'expected', 'missed']))
  })

  test('a download comes with an episode that is had or under way, and only then', () => {
    for (const state of ['have', 'downloading']) {
      expect(accepts(SeriesEpisodesDto, page([episode({ state, downloadId: 3 })])), state).toBe(true)
      expect(accepts(SeriesEpisodesDto, page([episode({ state })])), state).toBe(false)
    }
    for (const state of ['expected', 'missed']) expect(accepts(SeriesEpisodesDto, page([episode({ state, downloadId: 3 })])), state).toBe(false)
    expect(accepts(SeriesEpisodesDto, page([episode({ state: 'aired' })]))).toBe(false)
  })

  test('every slice says which list of episodes it is from', () => {
    expect(accepts(SeriesEpisodesDto, page([]))).toBe(true)
    const { version: _, ...unversioned } = page([])
    expect(accepts(SeriesEpisodesDto, unversioned)).toBe(false)
    expect(accepts(SeriesEpisodesDto, { ...page([]), version: '' })).toBe(false)
  })

  test('the next page is asked for after the last number, not from a position', () => {
    const params = RPC_PARAMS['series.episodes']
    expect(params.parse({ id: 1, after: 200, limit: EPISODES_PAGE_MAX })).toEqual({ id: 1, after: 200, limit: EPISODES_PAGE_MAX })
    expect(accepts(params, { id: 1 })).toBe(true)
    for (const query of [{ id: 1, offset: 200 }, { id: 1, after: 1.5 }, { id: 1, limit: 0 }, { id: 1, limit: EPISODES_PAGE_MAX + 1 }])
      expect(accepts(params, query), JSON.stringify(query)).toBe(false)
  })

  test('air times are UTC instants', () => {
    expect(accepts(SeriesEpisodesDto, page([episode({ airstamp: '2026-10-02T15:00:00.000Z' })]))).toBe(true)
    for (const airstamp of ['2026-10-02T20:00:00+05:00', '2026-10-02', 'next Friday', ''])
      expect(accepts(SeriesEpisodesDto, page([episode({ airstamp })])), airstamp).toBe(false)
  })

  test('episodes are numbered from 1 and a page holds at most the app’s limit', () => {
    for (const number of [0, -1, 1.5]) expect(accepts(SeriesEpisodesDto, page([episode({ number })])), `${number}`).toBe(false)
    const full = Array.from({ length: EPISODES_PAGE_MAX }, (_, i) => episode({ number: i + 1 }))
    expect(accepts(SeriesEpisodesDto, page(full))).toBe(true)
    expect(accepts(SeriesEpisodesDto, page([...full, episode({ number: EPISODES_PAGE_MAX + 1 })]))).toBe(false)
    expect(Number(/pub const PAGE_MAX: usize = ([0-9_]+);/.exec(rust('series/episodes.rs'))?.[1])).toBe(EPISODES_PAGE_MAX)
  })
})
