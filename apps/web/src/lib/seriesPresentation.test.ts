import type { SeriesEpisodeDto } from '@magnetar/protocol'
import fc from 'fast-check'
import { describe, expect, test } from 'vitest'
import en from '../i18n/en.json'
import pl from '../i18n/pl.json'
import ru from '../i18n/ru.json'
import { calendarDistance, episodeAirDate, episodeArc, upcomingEpisodes } from './seriesPresentation.ts'

const episode = (number: number, airstamp: string | null, state: 'expected' | 'missed' = 'expected'): SeriesEpisodeDto => ({ number, airstamp, name: null, state })
const now = new Date(2026, 9, 15, 0, 10).getTime()

describe('episode approach', () => {
  test('no air dates and invalid dates never invent a date or a point', () => {
    expect(upcomingEpisodes([episode(1, null), episode(2, 'invalid')], now)).toEqual([])
  })
  test('today includes an already aired episode and keeps two airings on one day in episode order', () => {
    const today = new Date(2026, 9, 15, 0, 1).toISOString()
    expect(upcomingEpisodes([episode(2, today), episode(1, today)], now).map(e => e.number)).toEqual([1, 2])
    expect(calendarDistance(today, now)).toBe(0)
  })
  test('uses the viewer calendar at midnight and bounds the approach to fourteen days', () => {
    const dates = [new Date(2026, 9, 14, 23, 59), new Date(2026, 9, 15, 0, 0), new Date(2026, 9, 29, 23, 59), new Date(2026, 9, 30, 0, 0)]
    expect(dates.map(d => calendarDistance(d.toISOString(), now))).toEqual([-1, 0, 14, 15])
    expect(upcomingEpisodes(dates.map((d, i) => episode(i+1, d.toISOString())), now).map(e => e.number)).toEqual([2, 3])
  })
  test('excludes held and missed episodes, orders dates, and never mutates the device list', () => {
    const today = new Date(2026, 9, 15).toISOString(), tomorrow = new Date(2026, 9, 16).toISOString()
    const input: SeriesEpisodeDto[] = [episode(3, tomorrow), episode(2, today, 'missed'), { ...episode(1, today), state: 'have', downloadId: 1 }, { ...episode(4, today), state: 'downloading', downloadId: 2 }]
    expect(upcomingEpisodes(input, now).map(e => e.number)).toEqual([4, 3])
    expect(input.map(e => e.number)).toEqual([3, 2, 1, 4])
  })
  test('permutations keep date order and repeated filtering is idempotent', () => {
    fc.assert(fc.property(fc.uniqueArray(fc.integer({ min: -5, max: 20 }), {maxLength: 26}), days => {
      const rows = days.map((d, i) => episode(i+1, new Date(2026, 9, 15+d, 12).toISOString()))
      const result = upcomingEpisodes(rows, now)
      expect(result.map(e => calendarDistance(e.airstamp!, now))).toEqual(days.filter(d => d >= 0 && d <= 14).sort((a,b) => a-b))
      expect(upcomingEpisodes(result, now)).toEqual(result)
    }))
  })
})

test('one and sixty episode seasons have distinct, finite arcs with a gap', () => {
  expect(episodeArc(0, 1)).toBe('M41.309 10.029A30 30 0 1 1 38.691 10.029')
  const arcs = Array.from({length: 60}, (_, i) => episodeArc(i, 60))
  expect(new Set(arcs).size).toBe(60)
  expect(arcs[0]).toBe('M40.628 10.007A30 30 0 0 1 42.510 10.105')
  fc.assert(fc.property(fc.integer({min:1,max:200}), n => {
    const paths = Array.from({length:n}, (_, i) => episodeArc(i,n))
    expect(new Set(paths).size).toBe(n)
    expect(paths.every(p => !/NaN|Infinity/.test(p))).toBe(true)
  }))
})

test('air dates use native weekday cases and English day-month order', () => {
  const translate = (strings: Record<string, string>) => (key: string) => strings[key] ?? key
  const wednesday = new Date(2026, 9, 14, 12).toISOString()
  const saturday = new Date(2026, 9, 17, 12).toISOString()
  expect(episodeAirDate(wednesday, 'en', translate(en.strings))).toBe('Wednesday, 14 October')
  expect(episodeAirDate(wednesday, 'pl', translate(pl.strings), true)).toBe('w środę')
  expect(episodeAirDate(saturday, 'pl', translate(pl.strings), true)).toBe('w sobotę')
  expect(episodeAirDate(wednesday, 'ru', translate(ru.strings), true)).toBe('в среду')
})
