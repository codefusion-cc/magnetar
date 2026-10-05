import { describe, expect, test } from 'vitest'
import { DEFAULT_DOWNLOAD_SORT, parseDownloadSort, readDownloadSort, sortDownloads, writeDownloadSort } from './downloadSort.ts'

const d = (name: string, addedAt: string, totalBytes: number, progress = 0) => ({ name, addedAt, totalBytes, progress })
const names = (list: { name: string }[]) => list.map(x => x.name)

const a = d('a', '2026-03-01T10:00:00Z', 100, 50)
const b = d('b', '2026-01-01T10:00:00Z', 300, 10)
const c = d('c', '2026-02-01T10:00:00Z', 200, 90)

describe('sorting downloads', () => {
  test('newest first, oldest first', () => {
    expect(names(sortDownloads([b, a, c], 'newest'))).toEqual(['a', 'c', 'b'])
    expect(names(sortDownloads([a, b, c], 'oldest'))).toEqual(['b', 'c', 'a'])
  })

  test('size puts the largest first and progress the most complete first', () => {
    expect(names(sortDownloads([a, b, c], 'size'))).toEqual(['b', 'c', 'a'])
    expect(names(sortDownloads([a, b, c], 'progress'))).toEqual(['c', 'a', 'b'])
  })

  test('names ignore case and accents and count numbers by value', () => {
    const list = ['Episode 10', 'episode 2', 'Émile', 'emma', 'Zed', 'Ébène'].map(n => d(n, '2026-01-01T00:00:00Z', 1))
    expect(names(sortDownloads(list, 'name'))).toEqual(['Ébène', 'Émile', 'emma', 'episode 2', 'Episode 10', 'Zed'])
  })

  test('missing values go last, in either direction', () => {
    const unknown = d('unknown', '', 0)
    const broken = d('broken', 'not a date', 0)
    for (const sort of ['newest', 'oldest'] as const) expect(names(sortDownloads([unknown, a, broken, b], sort)).slice(0, 2)).toEqual(sort === 'newest' ? ['a', 'b'] : ['b', 'a'])
    expect(names(sortDownloads([unknown, a, b], 'size'))).toEqual(['b', 'a', 'unknown'])
    expect(names(sortDownloads([unknown, broken, a], 'newest'))).toEqual(['a', 'unknown', 'broken'])
  })

  test('ties keep the order they came in', () => {
    const same = ['x', 'y', 'z', 'w'].map(n => d(n, '2026-01-01T00:00:00Z', 5, 5))
    for (const sort of ['newest', 'oldest', 'size', 'progress', 'name'] as const) {
      expect(names(sortDownloads(sort === 'name' ? same.map(x => ({ ...x, name: 'same' })) : same, sort)).join('')).toBe(sort === 'name' ? 'samesamesamesame' : 'xyzw')
    }
  })

  test('rows do not move while progress changes, except when sorted by progress', () => {
    const before = [d('p', '2026-01-03T00:00:00Z', 100, 10), d('q', '2026-01-02T00:00:00Z', 200, 20), d('r', '2026-01-01T00:00:00Z', 300, 30)]
    const after = before.map(x => ({ ...x, progress: 100 - x.progress }))
    for (const sort of ['newest', 'oldest', 'name', 'size'] as const) expect(names(sortDownloads(after, sort))).toEqual(names(sortDownloads(before, sort)))
    expect(names(sortDownloads(after, 'progress'))).not.toEqual(names(sortDownloads(before, 'progress')))
  })

  test('leaves the list it was given alone', () => {
    const list = [b, a]
    sortDownloads(list, 'newest')
    expect(names(list)).toEqual(['b', 'a'])
  })
})

describe('the remembered order', () => {
  const memory = () => {
    const data = new Map<string, string>()
    return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) }
  }

  test('is restored per device', () => {
    const storage = memory()
    writeDownloadSort('nas', 'size', storage)
    expect(readDownloadSort('nas', storage)).toBe('size')
    expect(readDownloadSort('laptop', storage)).toBe(DEFAULT_DOWNLOAD_SORT)
  })

  test('falls back to newest first for a value that is not an order', () => {
    for (const bad of ['', 'sideways', 'null', '{"a":1}', null]) expect(parseDownloadSort(bad)).toBe('newest')
    expect(readDownloadSort('nas', { getItem: () => 'oldest-ish', setItem: () => {} })).toBe('newest')
  })

  test('works without browser storage', () => {
    const blocked = { getItem: () => { throw new Error('SecurityError') }, setItem: () => { throw new Error('Quota') } }
    expect(readDownloadSort('nas', blocked)).toBe('newest')
    expect(() => writeDownloadSort('nas', 'name', blocked)).not.toThrow()
    expect(readDownloadSort('nas', undefined)).toBe('newest')
  })
})
