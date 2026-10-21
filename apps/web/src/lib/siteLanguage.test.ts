import { afterEach, describe, expect, test, vi } from 'vitest'
import { SITE_LANGUAGE_KEY, siteLanguage, storedSiteLanguage, storeSiteLanguage } from './siteLanguage.ts'

/** A browser's storage, in memory. */
function memory(entries: Record<string, string> = {}) {
  const map = new Map(Object.entries(entries))
  return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), map }
}

const refusing = {
  getItem: () => { throw new DOMException('The operation is insecure.', 'SecurityError') },
  setItem: () => { throw new DOMException('Quota exceeded', 'QuotaExceededError') },
}

/** A browser whose languages are `languages`, most preferred first. */
const speaks = (...languages: string[]) => vi.stubGlobal('navigator', { languages, language: languages[0] ?? '' })

afterEach(() => vi.unstubAllGlobals())

describe('the website language chosen in this browser', () => {
  test('nothing chosen: the browser’s own language when the website is written in it', () => {
    speaks('pl-PL', 'en-US')
    expect(storedSiteLanguage(memory())).toBeNull()
    expect(siteLanguage(memory())).toBe('pl')
  })

  test('nothing chosen and a browser in a language the website lacks: English', () => {
    speaks('de-DE', 'fr-FR')
    expect(siteLanguage(memory())).toBe('en')
  })

  test('a choice wins over the browser’s language, both ways', () => {
    speaks('pl-PL')
    expect(siteLanguage(memory({ [SITE_LANGUAGE_KEY]: 'en' }))).toBe('en')
    speaks('en-GB')
    expect(siteLanguage(memory({ [SITE_LANGUAGE_KEY]: 'pl' }))).toBe('pl')
  })

  test.for(['de', '', 'PL', 'pl-PL', ' pl', 'en\u0000', '__proto__', 'x'.repeat(10_000)].map(code => ({ code, shown: code.length > 20 ? `${code.length} letters` : JSON.stringify(code) })))('a stored $shown, dropped or never offered, is no choice', ({ code }) => {
    speaks('pl-PL')
    const storage = memory({ [SITE_LANGUAGE_KEY]: code })
    expect(storedSiteLanguage(storage)).toBeNull()
    expect(siteLanguage(storage)).toBe('pl')
  })

  test('storage refusing to be read: the browser’s language, no error', () => {
    speaks('pl')
    expect(storedSiteLanguage(refusing)).toBeNull()
    expect(siteLanguage(refusing)).toBe('pl')
  })

  test('storage refusing to be written: the choice is dropped, no error', () => {
    expect(() => storeSiteLanguage('pl', refusing)).not.toThrow()
  })

  test('storage the page can’t even reach: the browser’s language, and storing does nothing', () => {
    speaks('pl-PL')
    vi.stubGlobal('localStorage', undefined)
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get: () => { throw new DOMException('Blocked', 'SecurityError') } })
    expect(siteLanguage()).toBe('pl')
    expect(() => storeSiteLanguage('en')).not.toThrow()
  })

  test('a stored choice is read back as made, and a later one replaces it', () => {
    speaks('en-US')
    const storage = memory()
    storeSiteLanguage('pl', storage)
    expect(storage.map.get(SITE_LANGUAGE_KEY)).toBe('pl')
    expect(siteLanguage(storage)).toBe('pl')
    storeSiteLanguage('en', storage)
    expect(siteLanguage(storage)).toBe('en')
  })
})
