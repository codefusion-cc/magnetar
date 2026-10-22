import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { browserLanguage, I18nProvider, LANGUAGES, loadCatalog, useLanguage, useT } from '../lib/i18n.tsx'
import { siteLanguage, siteLanguageChoice, storeSiteLanguage } from '../lib/siteLanguage.ts'
import { useToast } from '../ui/toast.tsx'

interface SiteLanguageState {
  /** The language the website's own pages are in. */
  language: string
  /**
   * Shows the pages in `code` once its words have loaded and keeps it as this browser's choice. False when its words
   * could not be loaded: the pages stay as they are and nothing is kept.
   */
  choose: (code: string) => Promise<boolean>
}

const SiteLanguageContext = createContext<SiteLanguageState>({ language: 'en', choose: async () => false })

export function useSiteLanguage(): SiteLanguageState {
  return useContext(SiteLanguageContext)
}

/**
 * The website's pages in the language chosen in this browser, else the browser's. A new choice waits for its words
 * so the page never blanks while they load, and another tab's choice is followed.
 */
export function SiteLanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState(siteLanguage)
  // Only the latest choice lands: a slower catalog must not undo a quicker choice made after it.
  const latest = useRef(0)
  // Resolves whether `code`'s words loaded; a catalog that fails resolves English, which is no switch.
  const show = useCallback(async (code: string) => {
    const at = ++latest.current
    const shown = (await loadCatalog(code)).language === code
    if (shown && at === latest.current) setLanguage(code)
    return shown
  }, [])
  const choose = useCallback(async (code: string) => {
    const at = latest.current + 1
    const shown = await show(code)
    if (shown && at === latest.current) storeSiteLanguage(code)
    return shown
  }, [show])
  useEffect(() => siteLanguageChoice().subscribe(code => void show(code ?? browserLanguage())), [show])
  const value = useMemo(() => ({ language, choose }), [language, choose])
  return (
    <SiteLanguageContext.Provider value={value}>
      <I18nProvider language={language}>{children}</I18nProvider>
    </SiteLanguageContext.Provider>
  )
}

/**
 * The footer's languages, each by its own name, the one shown marked. A page whose address names its language passes
 * `href`, and a choice goes to that language's address; elsewhere the page changes where it is.
 */
export function LanguageSwitch({ href }: { href?: (code: string) => string }) {
  const t = useT()
  const shown = useLanguage()
  const { choose } = useSiteLanguage()
  const toast = useToast()
  const pick = (code: string) => void choose(code).then(ok => { if (!ok) toast(t('site.languageFailed'), 'error') })
  return (
    <span role="group" aria-label={t('settings.language')} className="site-languages">
      {LANGUAGES.map(({ code, name }) => {
        const current = code === shown
        return href
          ? <Link key={code} to={href(code)} replace lang={code} className="setting-link" aria-current={current || undefined} onClick={() => pick(code)}>{name}</Link>
          : <button key={code} type="button" lang={code} className="setting-link" aria-pressed={current} onClick={() => { if (!current) pick(code) }}>{name}</button>
      })}
    </span>
  )
}
