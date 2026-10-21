import type { DownloadDto } from '@magnetar/protocol'
import { formatBytes, formatRate } from '@magnetar/protocol/bytes'
import fc from 'fast-check'
import { describe, expect, test } from 'vitest'
import english from '../i18n/en.json'
import polish from '../i18n/pl.json'
import { formatEta, pluralMessage } from './i18n.tsx'
import { downloadDay, downloadSummary, noPeersError, retainFinished, searchForName } from './downloadPresentation.ts'
import { RESOLUTIONS } from './quality.ts'
import { readSearch, searchAddress, type SearchChoices } from './urlState.ts'

const translate = (strings: Record<string, string>) => (key: string, ...args: (string | number)[]) => (strings[key] ?? key).replace(/\{(\d+)\}/g, (_, n) => String(args[Number(n)]))
const en = translate(english.strings)
const pl = translate(polish.strings)

describe('download presentation', () => {
  test('recognizes the device metadata timeout while leaving other errors untouched', () => {
    expect(noPeersError('No peers found — the torrent may be dead or have no seeders.')).toBe(true)
    expect(noPeersError('No peers after 3 minutes')).toBe(true)
    expect(noPeersError(null)).toBe(false)
    expect(noPeersError('Permission denied writing to /Movies')).toBe(false)
    fc.assert(fc.property(fc.string(), message => {
      expect(noPeersError(`Permission denied: ${message}`)).toBe(false)
    }))
  })

  test('zero, one and many name the computer, count and decimal rate', () => {
    expect(downloadSummary(en, 'en', 'Mac-Mini-M1', 0, 0)).toBe('Mac-Mini-M1 is not downloading anything right now.')
    expect(downloadSummary(en, 'en', 'Mac-Mini-M1', 1, 3.4e6)).toBe('Mac-Mini-M1 is downloading one thing at 3.4\u00a0MB/s.')
    expect(downloadSummary(en, 'en', 'Mac-Mini-M1', 6, 31.4e6)).toBe('Mac-Mini-M1 is downloading 6 things at 31.4\u00a0MB/s.')
    expect(downloadSummary(pl, 'pl', 'Mac-Mini-M1', 0, 0)).toBe('Mac-Mini-M1 niczego teraz nie pobiera.')
    expect(downloadSummary(pl, 'pl', 'Mac-Mini-M1', 1, 3.4e6)).toBe('Mac-Mini-M1 pobiera jedną rzecz z prędkością 3,4\u00a0MB/s.')
    for (const n of [2, 4, 5, 12, 21, 22, 25, 101, 102, 112]) {
      expect(downloadSummary(pl, 'pl', 'Mac-Mini-M1', n, 31.4e6)).toBe(`Mac-Mini-M1 pobiera ${n} rzeczy z prędkością 31,4\u00a0MB/s.`)
    }
  })

  test('plural families keep Polish final digits and fall back to other', () => {
    expect([1, 2, 5, 12, 21, 22, 112].map(n => pluralMessage(pl, 'pl', 'search.results', n, n))).toEqual(['1 wynik', '2 wyniki', '5 wyników', '12 wyników', '21 wyników', '22 wyniki', '112 wyników'])
    const sparse = translate({ 'sample.other': '{0} items' })
    expect(pluralMessage(sparse, 'pl', 'sample', 2, 2)).toBe('2 items')
    expect(pluralMessage(pl, 'pl', 'downloads.minutesLeft', 22, 22)).toBe('zostały 22 min')
  })

  test('sizes use decimal units and local decimal separators at the unit boundary', () => {
    expect(formatBytes(0, 1, { decimal: true, locale: 'en' })).toBe('0\u00a0B')
    expect(formatBytes(999, 1, { decimal: true, locale: 'en' })).toBe('999\u00a0B')
    expect(formatBytes(1000, 1, { decimal: true, locale: 'en' })).toBe('1\u00a0KB')
    expect(formatBytes(1.9e9, 1, { decimal: true, locale: 'pl' })).toBe('1,9\u00a0GB')
    expect(formatBytes(137.8e9, 1, { decimal: true, locale: 'en' })).toBe('137.8\u00a0GB')
    expect(formatBytes(NaN, 1, { decimal: true, locale: 'en' })).toBe('0\u00a0B')
    expect(formatRate(1.5e9, 1, { decimal: true, locale: 'pl' })).toBe('1,5\u00a0GB/s')
  })

  test('existing byte formatter callers keep binary units and rates', () => {
    expect(formatBytes(1024)).toBe('1\u00a0KiB')
    expect(formatBytes(1024 ** 3)).toBe('1\u00a0GiB')
    expect(formatRate(3.4 * 1024 ** 2)).toBe('3.4\u00a0MiB/s')
    expect(formatBytes(-1)).toBe('0\u00a0B')
    fc.assert(fc.property(fc.integer({ min: 0, max: 999 }), bytes => {
      expect(formatBytes(bytes, 1, { decimal: true, locale: 'en' })).toBe(`${bytes}\u00a0B`)
      expect(formatBytes(bytes)).toBe(`${bytes}\u00a0B`)
    }))
  })

  test('time left rounds at the minute and hour boundaries', () => {
    expect(formatEta(en, 'en', 0)).toBe('1 min left')
    expect(formatEta(en, 'en', 719)).toBe('12 min left')
    expect(formatEta(en, 'en', 4800)).toBe('1 h 20 min left')
    expect(formatEta(pl, 'pl', 120)).toBe('zostały 2 min')
    expect(formatEta(pl, 'pl', 300)).toBe('zostało 5 min')
  })

  test('calendar dates follow the local day, including yesterday across a month boundary', () => {
    const now = new Date(2026, 9, 1, 0, 5)
    expect(downloadDay('en', new Date(2026, 9, 1, 0, 1).toISOString(), false, now)).toBe('today')
    expect(downloadDay('pl', new Date(2026, 8, 30, 23, 59).toISOString(), false, now)).toBe('wczoraj')
    expect(downloadDay('en', new Date(2026, 9, 1, 0, 1).toISOString(), true, now, 'file')).toBe('today 00:01')
    expect(downloadDay('en', 'invalid')).toBe('—')
  })

  test('finished rows stay until the view changes, removed downloads leave, and retention is idempotent', () => {
    const rows = [{ id: 1, status: 'Completed' }, { id: 2, status: 'Paused' }, { id: 3, status: 'Seeding' }] as DownloadDto[]
    expect([...retainFinished(new Set([1, 9]), [], rows)]).toEqual([1])
    expect([...retainFinished(new Set(), [{ id: 3, status: 'Downloading' }] as DownloadDto[], rows)]).toEqual([3])
    fc.assert(fc.property(fc.uniqueArray(fc.integer({ min: 0, max: 1000 })), ids => {
      const list = ids.map(id => ({ id, status: id % 2 ? 'Completed' : 'Downloading' })) as DownloadDto[]
      const retained = retainFinished(new Set(ids), [], list)
      expect([...retainFinished(retained, list, list)]).toEqual(ids.filter(id => id % 2))
      expect([...retainFinished(retained, list, [])]).toEqual([])
    }))
  })
})

describe('searching for a download by name', () => {
  const choices: SearchChoices<string, string> = { resolutions: RESOLUTIONS, sorts: [['seeders', 'seeders'], ['newest', 'new']], sources: [] }
  /** What the Search page reads from the address the link opens, under a computer's pages. */
  const opened = (name: string) => {
    const url = new URL(`/Mac-Mini-M1${searchForName(name)}`, 'https://magnetar.example')
    const prefix = '/Mac-Mini-M1/search'
    return { inPage: url.pathname === prefix || url.pathname.startsWith(`${prefix}/`), url, view: readSearch(url.pathname.slice(prefix.length + 1), url.searchParams, choices) }
  }

  test('a name of only dots stays on the Search page', () => {
    for (const name of ['.', '..']) {
      const { inPage, view } = opened(name)
      expect(inPage, name).toBe(true)
      expect(view.query).toBe(name)
    }
  })

  test('the link is the address the Search page itself writes for that text', () => {
    for (const name of ['Sintel (2010) 1080p BluRay', 'a+b & c/d?e#f', 'Zażółć gęślą jaźń', 'Миры 🌟']) {
      const { url, view } = opened(name)
      expect(view.query).toBe(name)
      expect(url.pathname.slice('/Mac-Mini-M1'.length) + url.search).toBe(searchAddress(view, choices))
    }
  })

  test('any name opens the Search page for that name', () => {
    fc.assert(fc.property(fc.string({ unit: 'grapheme', maxLength: 200 }), name => {
      const { inPage, view } = opened(name)
      expect(inPage).toBe(true)
      expect(view).toEqual({ query: name.trim(), resolution: '', source: '', sort: 'seeders' })
    }))
  })
})
