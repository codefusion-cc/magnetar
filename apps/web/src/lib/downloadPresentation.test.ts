import type { DownloadDto } from '@magnetar/protocol'
import { formatBytes, formatRate } from '@magnetar/protocol/bytes'
import fc from 'fast-check'
import { describe, expect, test } from 'vitest'
import english from '../i18n/en.json'
import polish from '../i18n/pl.json'
import { downloadBytes, downloadDay, downloadEta, downloadSummary, retainFinished } from './downloadPresentation.ts'

const translate = (strings: Record<string, string>) => (key: string, ...args: (string | number)[]) => (strings[key] ?? key).replace(/\{(\d+)\}/g, (_, n) => String(args[Number(n)]))
const en = translate(english.strings)
const pl = translate(polish.strings)

describe('download presentation', () => {
  test('zero, one and many name the computer, count and decimal rate', () => {
    expect(downloadSummary(en, 'en', 'Mac-Mini-M1', 0, 0)).toBe('Mac-Mini-M1 is not downloading anything right now.')
    expect(downloadSummary(en, 'en', 'Mac-Mini-M1', 1, 3.4e6)).toBe('Mac-Mini-M1 is downloading one thing at 3.4 MB/s.')
    expect(downloadSummary(en, 'en', 'Mac-Mini-M1', 6, 31.4e6)).toBe('Mac-Mini-M1 is downloading 6 things at 31.4 MB/s.')
    expect(downloadSummary(pl, 'pl', 'Mac-Mini-M1', 0, 0)).toBe('Mac-Mini-M1 niczego teraz nie pobiera.')
    expect(downloadSummary(pl, 'pl', 'Mac-Mini-M1', 1, 3.4e6)).toBe('Mac-Mini-M1 pobiera jedną rzecz z prędkością 3,4 MB/s.')
    for (const n of [2, 4, 5, 12, 21, 22, 25, 101, 102, 112]) {
      expect(downloadSummary(pl, 'pl', 'Mac-Mini-M1', n, 31.4e6)).toBe(`Mac-Mini-M1 pobiera ${n} rzeczy z prędkością 31,4 MB/s.`)
    }
  })

  test('Polish selects one, few and other including the teens and final digits', () => {
    const key = (k: string) => k
    expect([0, 1, 2, 5, 12, 21, 22, 112].map(n => downloadSummary(key, 'pl', 'PC', n, 0))).toEqual([
      'downloads.summary.zero', 'downloads.summary.one', 'downloads.summary.few', 'downloads.summary.other',
      'downloads.summary.other', 'downloads.summary.other', 'downloads.summary.few', 'downloads.summary.other',
    ])
  })

  test('sizes use decimal units and local decimal separators at the unit boundary', () => {
    expect(downloadBytes(0, 'en')).toBe('0 B')
    expect(downloadBytes(999, 'en')).toBe('999 B')
    expect(downloadBytes(1000, 'en')).toBe('1 KB')
    expect(downloadBytes(1.9e9, 'pl')).toBe('1,9 GB')
    expect(downloadBytes(137.8e9, 'en')).toBe('137.8 GB')
    expect(downloadBytes(NaN, 'en')).toBe('0 B')
  })

  test('existing byte formatter callers keep binary units and rates', () => {
    expect(formatBytes(1024)).toBe('1 KiB')
    expect(formatBytes(1024 ** 3)).toBe('1 GiB')
    expect(formatRate(3.4 * 1024 ** 2)).toBe('3.4 MiB/s')
    expect(formatBytes(-1)).toBe('0 B')
    fc.assert(fc.property(fc.integer({ min: 0, max: 999 }), bytes => {
      expect(downloadBytes(bytes, 'en')).toBe(`${bytes} B`)
      expect(formatBytes(bytes)).toBe(`${bytes} B`)
    }))
  })

  test('time left rounds at the minute and hour boundaries', () => {
    expect(downloadEta(en, 0)).toBe('1 min left')
    expect(downloadEta(en, 719)).toBe('12 min left')
    expect(downloadEta(en, 4800)).toBe('1 h 20 min left')
    expect(downloadEta(pl, 120, 'pl')).toBe('zostały 2 min')
    expect(downloadEta(pl, 300, 'pl')).toBe('zostało 5 min')
  })

  test('calendar dates follow the local day, including yesterday across a month boundary', () => {
    const now = new Date(2026, 9, 1, 0, 5)
    expect(downloadDay(en, 'en', new Date(2026, 9, 1, 0, 1).toISOString(), false, now)).toBe('today')
    expect(downloadDay(pl, 'pl', new Date(2026, 8, 30, 23, 59).toISOString(), false, now)).toBe('wczoraj')
  })

  test('finished rows stay until the view changes, removed downloads leave, and retention is idempotent', () => {
    const rows = [{ id: 1, status: 'Completed' }, { id: 2, status: 'Paused' }, { id: 3, status: 'Seeding' }] as DownloadDto[]
    expect([...retainFinished(new Set([1, 9]), rows)]).toEqual([1, 2])
    expect([...retainFinished(new Set(), rows)]).toEqual([2])
    fc.assert(fc.property(fc.uniqueArray(fc.integer({ min: 0, max: 1000 })), ids => {
      const list = ids.map(id => ({ id, status: id % 2 ? 'Completed' : 'Downloading' })) as DownloadDto[]
      const retained = retainFinished(new Set(ids), list)
      expect([...retainFinished(retained, list)]).toEqual(ids)
      expect([...retainFinished(retained, [])]).toEqual([])
    }))
  })
})
