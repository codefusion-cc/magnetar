import { plural, formatters, type PluralForms } from '@codefusion-cc/i18n'
import { formatBytes, formatRate } from '@magnetar/protocol/bytes'
import { applyDocumentLocale } from '@codefusion-cc/i18n/browser'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import english from '../i18n/en.json'
import { Loading } from '../ui/Loading.tsx'
import { LANGUAGES } from './languages.ts'

interface Catalog {
  name: string
  strings: Record<string, string>
}

export { LANGUAGES }

const loaders = Object.fromEntries(
  Object.entries(import.meta.glob<Catalog>(['../i18n/*.json', '!../i18n/en.json'], { import: 'default' }))
    .map(([path, load]) => [path.match(/([a-z]{2})\.json$/)![1]!, load]),
) as Record<string, () => Promise<Catalog>>

/** A catalog as shown: its strings, and the language they are in (English when the asked-for one failed to load). */
interface Shown {
  language: string
  strings: Record<string, string>
}

const ENGLISH: Shown = { language: 'en', strings: english.strings }
const loaded: Record<string, Shown> = { en: ENGLISH }

export type Translate = (key: string, ...args: (string | number)[]) => string

function translator(strings: Record<string, string>): Translate {
  const fallback = english.strings as Record<string, string>
  return (key, ...args) => {
    const template = strings[key] ?? fallback[key] ?? key
    return args.length ? template.replace(/\{(\d+)\}/g, (match, i: string) => String(args[Number(i)] ?? match)) : template
  }
}

/** The browser's language when a catalog exists for it, else English. */
export function browserLanguage(): string {
  for (const tag of navigator.languages ?? [navigator.language]) {
    const code = tag.slice(0, 2).toLowerCase()
    if (LANGUAGES.some(l => l.code === code)) return code
  }
  return 'en'
}

/**
 * The catalog for `code`, loaded once. One that can't be loaded shows English this time, and is asked for again
 * next time; a language without a catalog is English.
 */
export async function loadCatalog(code: string, load: (() => Promise<Catalog>) | undefined = loaders[code]): Promise<Shown> {
  if (loaded[code]) return loaded[code]
  if (!load) return ENGLISH
  try {
    return (loaded[code] = { language: code, strings: (await load()).strings })
  } catch {
    return ENGLISH
  }
}

/** The translated parts on screen, outermost first, each with the language it shows. */
const claims: { depth: number; language: string }[] = []

/**
 * Says a translated part `depth` providers deep shows `language`. `<html lang>` (and `dir`) follow the deepest
 * part on screen, the newest of equals, so screen readers read the page in the language it is in. Returns the
 * function that withdraws the claim.
 */
export function claimDocumentLanguage(depth: number, language: string, doc: Document = document): () => void {
  const claim = { depth, language }
  claims.push(claim)
  const apply = () => {
    const shown = claims.reduce<typeof claim | null>((best, c) => (!best || c.depth >= best.depth ? c : best), null)
    applyDocumentLocale({ lang: shown?.language ?? 'en' }, doc)
  }
  apply()
  return () => {
    const at = claims.indexOf(claim)
    if (at === -1) return
    claims.splice(at, 1)
    apply()
  }
}

const I18nContext = createContext<{ language: string; t: Translate }>({ language: 'en', t: translator(english.strings) })
/** How many providers wrap this one: the innermost decides the document's language. */
const DepthContext = createContext(0)

/**
 * Translations for `language`. A language not loaded yet is fetched first; the page waits for it
 * rather than flashing English, and shows English if it can't be loaded. The document's language is
 * the one shown.
 */
export function I18nProvider({ language, children }: { language: string; children: ReactNode }) {
  const code = loaders[language] || language === 'en' ? language : 'en'
  const [shown, setShown] = useState<Shown | null>(() => loaded[code] ?? null)
  useEffect(() => {
    if (loaded[code]) return setShown(loaded[code])
    let cancelled = false
    void loadCatalog(code).then(catalog => { if (!cancelled) setShown(catalog) })
    return () => { cancelled = true }
  }, [code])
  const depth = useContext(DepthContext)
  useEffect(() => (shown ? claimDocumentLanguage(depth, shown.language) : undefined), [depth, shown])
  const value = useMemo(() => ({ language: shown?.language ?? 'en', t: translator(shown?.strings ?? english.strings) }), [shown])
  if (!shown) {
    return <Loading screen />
  }
  return (
    <DepthContext.Provider value={depth + 1}>
      <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
    </DepthContext.Provider>
  )
}

export function useT(): Translate {
  return useContext(I18nContext).t
}

export function useLanguage(): string {
  return useContext(I18nContext).language
}

/** Locale-aware date formatting that follows the dashboard language. */
export function useFormatDate(): (iso: string | null, withTime?: boolean) => string {
  const language = useLanguage()
  return useCallback((iso, withTime = false) => {
    if (!iso) return '—'
    const date = new Date(iso)
    if (Number.isNaN(date.getTime())) return '—'
    return withTime
      ? formatters(language).date(iso, { dateStyle: 'medium', timeStyle: 'short' })
      : formatters(language).date(iso, { year: 'numeric', month: '2-digit', day: '2-digit' })
  }, [language])
}

const STEPS: [Intl.RelativeTimeFormatUnit, number][] = [['second', 60], ['minute', 60], ['hour', 24], ['day', 30], ['month', 12], ['year', Infinity]]

function relative(format: Intl.RelativeTimeFormat, seconds: number): string {
  let value = seconds
  for (const [unit, size] of STEPS) {
    if (Math.abs(value) < size) return format.format(Math.round(value), unit)
    value /= size
  }
  return ''
}

/** "3 yr. ago", "in 5 min." — in the dashboard language. */
export function useFormatRelative(style: Intl.RelativeTimeFormatStyle = 'short', numeric: Intl.RelativeTimeFormatNumeric = 'auto'): (iso: string | number | null, now?: number) => string {
  const language = useLanguage()
  const format = useMemo(() => new Intl.RelativeTimeFormat(language, { numeric, style }), [language, numeric, style])
  return useCallback((iso: string | number | null, now = Date.now()) => {
    if (iso === null || iso === undefined || iso === '') return '—'
    return relative(format, (new Date(iso).getTime() - now) / 1000)
  }, [format])
}

/**
 * A catalog family keyed by CLDR category (`base.one`, `base.few`, …, `base.other`). Every catalog has every key of
 * English (i18n/catalogs.test.ts), so the families English defines are complete everywhere.
 */
export function pluralMessage(t: Translate, language: string, base: string, count: number, ...args: (string | number)[]): string {
  const forms: PluralForms = { zero: `${base}.zero`, one: `${base}.one`, two: `${base}.two`, few: `${base}.few`, many: `${base}.many`, other: `${base}.other` }
  // Zero is an explicit empty-state sentence when a family supplies one.
  const zero = `${base}.zero`
  const key = count === 0 && t(zero) !== zero ? zero : plural(language, count, forms)
  const text = t(key, ...args)
  return text === key ? t(`${base}.other`, ...args) : text
}

/** Decimal sizes and rates throughout the dashboard. */
export function useFormatBytes() {
  const language = useLanguage()
  return useCallback((bytes: number, digits = 1) => formatBytes(bytes, digits, { decimal: true, locale: language }), [language])
}

export function useFormatRate() {
  const language = useLanguage()
  return useCallback((bytes: number, digits = 1) => formatRate(bytes, digits, { decimal: true, locale: language }), [language])
}

export function formatEta(t: Translate, language: string, seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60))
  if (minutes < 60) return pluralMessage(t, language, 'downloads.minutesLeft', minutes, minutes)
  return t('downloads.hoursLeft', Math.floor(minutes / 60), minutes % 60)
}

/** Time left in the download design's wording. */
export function useFormatEta(): (seconds: number) => string {
  const t = useT()
  const language = useLanguage()
  return useCallback((seconds: number) => formatEta(t, language, seconds), [t, language])
}

export { formatters }
