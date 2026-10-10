import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { isInstalledApp } from '../lib/installedApp.ts'
import { linkWording } from './linkWording.ts'

/** A page whose display mode is `mode`, as `matchMedia` would answer. */
const displayed = (mode: string) => ({ matchMedia: (query: string) => ({ matches: query === `(display-mode: ${mode})` }) })

describe('whether the page is an installed app', () => {
  test('a window of its own is an app: by display mode, and on iOS by navigator.standalone', () => {
    expect(isInstalledApp(displayed('standalone'))).toBe(true)
    expect(isInstalledApp({ ...displayed('browser'), navigator: { standalone: true } })).toBe(true)
    expect(isInstalledApp({ navigator: { standalone: true } })).toBe(true)
  })

  test('a browser tab is not, nor a page that cannot tell', () => {
    expect(isInstalledApp(displayed('browser'))).toBe(false)
    expect(isInstalledApp({ ...displayed('browser'), navigator: { standalone: false } })).toBe(false)
    expect(isInstalledApp({ ...displayed('browser'), navigator: {} })).toBe(false)
    expect(isInstalledApp({})).toBe(false)
  })
})

describe('what the not-linked screen calls itself', () => {
  const folder = join(import.meta.dirname, '../i18n')
  const languages = readdirSync(folder).filter(file => file.endsWith('.json')).map(file => file.slice(0, 2))
  const strings = (language: string) => (JSON.parse(readFileSync(join(folder, `${language}.json`), 'utf8')) as { strings: Record<string, string> }).strings
  const title = (language: string, page: Parameters<typeof isInstalledApp>[0]) =>
    strings(language)[linkWording(isInstalledApp(page)).title]!.replace('{0}', 'Test-Mac')

  test('an app in the installed app, a browser in a tab', () => {
    expect(title('en', displayed('standalone'))).toBe('This app isn’t linked to Test-Mac')
    expect(title('en', displayed('browser'))).toBe('This browser isn’t linked to Test-Mac')
    expect(title('pl', { navigator: { standalone: true } })).toBe('Ta aplikacja nie jest połączona z Test-Mac')
    expect(title('pl', displayed('browser'))).toBe('Ta przeglądarka nie jest połączona z Test-Mac')
    expect(strings('en')[linkWording(true).submit]).toBe('Link this app')
    expect(strings('en')[linkWording(false).submit]).toBe('Link this browser')
  })

  test('every language has its own words for the app, and names the device in both titles', () => {
    expect(languages).toHaveLength(8)
    for (const language of languages) {
      const s = strings(language)
      const [app, tab] = [linkWording(true), linkWording(false)]
      expect(s[app.title], language).toContain('{0}')
      expect(s[tab.title], language).toContain('{0}')
      expect(s[app.title], language).not.toBe(s[tab.title])
      expect(s[app.submit], language).not.toBe(s[tab.submit])
    }
  })
})
