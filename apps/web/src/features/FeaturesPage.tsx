/**
 * The features page, /features (in the browser's language) and /features/<language>: what Magnetar does, open to
 * everyone, with screenshots of the real app in the viewer's theme. The page is @codefusion-cc/features-page's;
 * the words are content/*.ts over outline.ts, the screenshots shots/ (apps/e2e/features/screenshots.ts).
 */
import '@codefusion-cc/features-page/styles.css'
import './features.css'
import { sectionLinks } from '@codefusion-cc/features-page'
import { applyDocumentLocale } from '@codefusion-cc/i18n/browser'
import { FeatureList, Features, FeaturesIndex, FeaturesNav, ShotFrame, ShotsProvider, shotUrls, useScrollToHash, type FeatureClassNames } from '@codefusion-cc/features-page/react'
import { useTheme } from '@codefusion-cc/theme/react'
import { ArrowRight, LogIn } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router'
import { useAccount } from '../cloud/CloudApp.tsx'
import { SiteFooter } from '../cloud/CloudFrame.tsx'
import { ThemeToggle } from '../ui/ThemeToggle.tsx'
import { DownloadApp } from '../cloud/DownloadApp.tsx'
import { browserLanguage, I18nProvider, LANGUAGES } from '../lib/i18n.tsx'
import { Select } from '../ui/Select.tsx'
import { BrandMark } from '../ui/BrandMark.tsx'
import { Loading } from '../ui/Loading.tsx'
import { theme } from '../ui/theme.ts'
import { builtOnEntries, featureGroups, FEATURE_LANGUAGES, loadContent, loadedContent, privacyEntries } from './content/index.ts'
import type { FeaturesContent } from './content/types.ts'
import { HERO_SHOT } from './outline.ts'
import SIZES from './shots.json'
import { MAGNETAR_REPO } from '@magnetar/protocol/cloud'

const shotUrl = shotUrls(import.meta.glob<string>('./shots/*.webp', { eager: true, query: '?url', import: 'default' }))
const REPOSITORY = `https://github.com/${MAGNETAR_REPO}`

/** The features: a row each, the text beside its screenshots on a wide screen. */
const ROWS: FeatureClassNames = {
  group: 'fp-section',
  groupTitle: 'fp-h2',
  groupLead: 'fp-lead',
  list: 'fp-rows',
  item: 'fp-row',
  title: 'fp-title',
  gain: 'fp-gain',
  text: 'fp-text',
  points: 'fp-points',
  more: 'fp-more',
  aside: 'fp-aside',
}

/** The short entries (what it keeps, what it is built on): a title and a line under it. */
const ENTRIES: FeatureClassNames = { list: 'fp-entries', item: 'fp-entry', title: 'fp-entry-title', text: 'fp-text' }

/** The language the address names (null for one the page isn't written in), else the browser's. */
function pageLanguage(param: string | undefined): string | null {
  if (param === undefined) return browserLanguage()
  return FEATURE_LANGUAGES.includes(param) ? param : null
}

export default function FeaturesRoute() {
  const { lang } = useParams()
  const language = pageLanguage(lang)
  // What the page shows for the language asked for: in it, or in English when it could not be loaded.
  const [shown, setShown] = useState<{ asked: string; language: string; content: FeaturesContent } | null>(() => {
    const ready = language ? loadedContent(language) : undefined
    return ready && language ? { asked: language, language, content: ready } : null
  })

  useEffect(() => {
    if (!language || shown?.asked === language) return
    let cancelled = false
    void loadContent(language).then(loaded => { if (!cancelled) setShown({ asked: language, ...loaded }) })
    return () => { cancelled = true }
  }, [language, shown?.asked])

  // An address in a language the page isn't written in: the one in the visitor's.
  if (!language) return <Navigate to="/features" replace />
  // Another language on its way: the page stays as it is (scroll, images) until its words arrive.
  if (!shown) return <Loading screen />
  return (
    <I18nProvider language={shown.language}>
      <FeaturesView language={shown.language} content={shown.content} />
    </I18nProvider>
  )
}

/** The tab, a shared link's preview and the document's language say what the page is, until it is left. */
function usePageMeta(language: string, meta: FeaturesContent['meta']) {
  useEffect(() => {
    const existing = document.querySelector<HTMLMetaElement>('meta[name="description"]')
    const before = { lang: document.documentElement.lang, title: document.title, description: existing?.content }
    applyDocumentLocale({ lang: language, title: meta.title, description: meta.description })
    return () => {
      applyDocumentLocale({ lang: before.lang, title: before.title, description: before.description })
      // The description this page made goes with it.
      if (!existing) document.querySelector('meta[name="description"]')?.remove()
    }
  }, [language, meta])
}

function FeaturesView({ language, content }: { language: string; content: FeaturesContent }) {
  const mode = useTheme(theme).resolved
  const groups = useMemo(() => featureGroups(content), [content])
  const privacy = useMemo(() => privacyEntries(content), [content])
  const builtOn = useMemo(() => builtOnEntries(content), [content])
  const links = useMemo(() => [
    ...sectionLinks(groups),
    { id: 'privacy', label: content.privacy.label },
    { id: 'built-on', label: content.builtOn.label },
  ], [groups, content])
  const shots = useMemo(() => ({ sizes: SIZES, url: shotUrl, mode }), [mode])
  usePageMeta(language, content.meta)
  useScrollToHash()

  return (
    <ShotsProvider library={shots}>
      <div className="features-page">
        <a href="#overview" className="fp-skip">{content.copy.skipToFeatures}</a>
        <Header language={language} content={content} />
        <main>
          <div className="fp-wrap fp-intro">
            <div>
              <h1>{content.hero.title}</h1>
              <p className="fp-lead">{content.hero.lead}</p>
              <p className="fp-actions">
                <a href="#overview" className="btn btn-primary btn-lg">{content.hero.primary}</a>
                <a href="#get-app" className="btn btn-lg">{content.hero.secondary}</a>
              </p>
            </div>
            {/* The app itself, beside the opening on a wide screen; its alt text is with the feature that shows it. */}
            <div className="fp-intro-shot" aria-hidden><ShotFrame src={HERO_SHOT} /></div>
          </div>

          <FeaturesNav label={content.copy.sectionsLabel} links={links} className="fp-nav" />

          <div className="fp-wrap">
            <section id="overview" aria-labelledby="overview-title" className="fp-section">
              <h2 id="overview-title" className="fp-h2">{content.copy.overview.title}</h2>
              <p className="fp-lead">{content.copy.overview.lead}</p>
              <FeaturesIndex groups={groups} level={3} className="fp-index" />
            </section>

            <Features groups={groups} copy={content.copy} classNames={ROWS} linkTitles />

            <section id="privacy" aria-labelledby="privacy-title" className="fp-section">
              <h2 id="privacy-title" className="fp-h2">{content.privacy.title}</h2>
              <p className="fp-lead">{content.privacy.lead}</p>
              <FeatureList features={privacy} level={3} classNames={ENTRIES} />
            </section>

            <section id="built-on" aria-labelledby="built-on-title" className="fp-section">
              <h2 id="built-on-title" className="fp-h2">{content.builtOn.title}</h2>
              <p className="fp-lead">{content.builtOn.lead} <a className="link" href={REPOSITORY}>{REPOSITORY.replace('https://', '')}</a></p>
              <FeatureList features={builtOn} level={3} classNames={ENTRIES} />
            </section>

            <Closing content={content} />
          </div>
        </main>
        <SiteFooter column="fp-wrap" />
      </div>
    </ShotsProvider>
  )
}

/** Where the page sends someone to use Magnetar: their devices when signed in, else sign-in. */
function useAccountLink(content: FeaturesContent) {
  const { account } = useAccount()
  return account ? { to: '/', label: content.header.devices, signedIn: true } : { to: '/login', label: content.header.signIn, signedIn: false }
}

function Header({ language, content }: { language: string; content: FeaturesContent }) {
  const navigate = useNavigate()
  const account = useAccountLink(content)
  return (
    <header className="fp-header">
      <div className="fp-wrap flex h-14 items-center gap-2">
        <Link to="/" className="flex min-h-10 flex-1 items-center gap-2.5 rounded-field" aria-label={content.header.home}>
          <BrandMark />
          <span className="font-display text-[15px]">Magnetar</span>
        </Link>
        <Select look="small" label={content.header.language} value={language} onChange={next => navigate(`/features/${next}`, { replace: true })}
          options={LANGUAGES.map(l => ({ value: l.code, label: l.name, lang: l.code }))} />
        <Link to={account.to} className="btn btn-primary btn-sm max-sm:btn-square" aria-label={account.label}>
          {account.signedIn ? <ArrowRight size={16} aria-hidden /> : <LogIn size={16} aria-hidden />}
          <span className="max-sm:hidden">{account.label}</span>
        </Link>
        <ThemeToggle />
      </div>
    </header>
  )
}

function Closing({ content }: { content: FeaturesContent }) {
  const account = useAccountLink(content)
  return (
    <section id="get-app" aria-labelledby="get-app-title" className="fp-section fp-get">
      <h2 id="get-app-title" className="fp-h2">{content.closing.title}</h2>
      <p className="fp-lead">{content.closing.lead}</p>
      <div className="fp-download"><DownloadApp /></div>
      <Link to={account.to} className="btn mt-6">
        {account.signedIn ? account.label : content.closing.signIn}<ArrowRight size={16} aria-hidden />
      </Link>
    </section>
  )
}
