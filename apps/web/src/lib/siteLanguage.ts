import { localeChoice, type LocaleChoice } from '@codefusion-cc/i18n/browser'
import { browserLanguage } from './i18n.tsx'
import { LANGUAGES } from './languages.ts'

/** Where this browser keeps the language chosen for the website's own pages. */
export const SITE_LANGUAGE_KEY = 'magnetar.siteLanguage'

type Store = Pick<Storage, 'getItem' | 'setItem'>

const CODES = LANGUAGES.map(l => l.code)

/**
 * The language chosen in this browser for the website's pages: read, kept and followed across tabs. Storage left out
 * is the page's own; storage that is blocked, full or holds a dropped language behaves as if nothing was chosen.
 */
export function siteLanguageChoice(storage?: Store | null): LocaleChoice<string> {
  return localeChoice(SITE_LANGUAGE_KEY, CODES, storage as Storage | null | undefined)
}

/** The language chosen in this browser, or null when none was, it was dropped since, or storage is blocked. */
export function storedSiteLanguage(storage?: Store | null): string | null {
  return siteLanguageChoice(storage).get()
}

/** The website's language: the one chosen in this browser, else the browser's own. */
export function siteLanguage(storage?: Store | null): string {
  return storedSiteLanguage(storage) ?? browserLanguage()
}

/** Keeps `code` as this browser's choice. Where storage is blocked the choice lasts until the page is left. */
export function storeSiteLanguage(code: string, storage?: Store | null): void {
  siteLanguageChoice(storage).set(code)
}
