import { describe, expect, test } from 'vitest'
import { computerLine, computerStar, platformName } from './computerLine.ts'

const t = (key: string, ...args: (string | number)[]) => `${key}(${args.join('|')})`
// Local times, so the calendar words are the same in every time zone the tests run in.
const now = new Date(2026, 9, 14, 20, 40)
const computer = { online: true, lastSeenAt: null, platform: 'macos', version: '1.2.2' }

describe('a computer on the list', () => {
  test('its star: lit to open now, far before this browser is linked, out while offline', () => {
    expect(computerStar({ online: true }, true)).toBe('lit')
    expect(computerStar({ online: true }, false)).toBe('far')
    expect(computerStar({ online: false }, true)).toBe('out')
    expect(computerStar({ online: false }, false)).toBe('out')
  })

  test('online and linked: the system and the version, and the update when one is newer', () => {
    expect(computerLine(t, 'en', computer, true, '1.2.2', now)).toBe('devices.statusOnline() devices.detailOnline(macOS|1.2.2)')
    expect(computerLine(t, 'en', computer, true, '1.3.0', now)).toBe('devices.statusOnline() devices.detailOnlineUpdate(macOS|1.2.2)')
    expect(computerLine(t, 'en', computer, true, null, now)).toBe('devices.statusOnline() devices.detailOnline(macOS|1.2.2)')
    // A computer newer than the latest release (a development build) waits for nothing.
    expect(computerLine(t, 'en', computer, true, '1.2.1', now)).toBe('devices.statusOnline() devices.detailOnline(macOS|1.2.2)')
  })

  test('offline: since when, in calendar words, and what it runs', () => {
    const off = { ...computer, online: false, lastSeenAt: new Date(2026, 9, 13, 23, 10).toISOString(), version: '1.1.0' }
    expect(computerLine(t, 'en', off, true, '1.2.2', now)).toMatch(/^devices\.statusOffline\(yesterday, 23:10\) devices\.detailOfflineUpdate\(1\.1\.0\)$/)
    expect(computerLine(t, 'en', { ...off, lastSeenAt: null }, true, null, now)).toBe('devices.statusOfflineNever() devices.detailOffline(1.1.0)')
    expect(computerLine(t, 'en', { ...off, lastSeenAt: 'not a date' }, true, null, now)).toBe('devices.statusOfflineNever() devices.detailOffline(1.1.0)')
  })

  test('not linked says so instead of what it runs, online or not', () => {
    expect(computerLine(t, 'en', computer, false, '9.9.9', now)).toBe('devices.statusOnline() devices.detailNotLinked()')
    expect(computerLine(t, 'en', { ...computer, online: false }, false, null, now)).toBe('devices.statusOfflineNever() devices.detailNotLinked()')
  })

  test('a computer that reports no version says only what it can', () => {
    expect(computerLine(t, 'en', { ...computer, version: '' }, true, '1.2.2', now)).toBe('devices.statusOnline() macOS')
    expect(computerLine(t, 'en', { ...computer, version: '', online: false }, true, '1.2.2', now)).toBe('devices.statusOfflineNever()')
  })
})

test('systems by the names people know, and one the app reports later as it is', () => {
  expect(['macos', 'windows', 'linux', 'freebsd'].map(platformName)).toEqual(['macOS', 'Windows', 'Linux', 'freebsd'])
})
