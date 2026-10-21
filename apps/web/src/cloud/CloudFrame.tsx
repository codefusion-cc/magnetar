import { useState, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router'
import { useT } from '../lib/i18n.tsx'
import { useInstallOffer } from '../lib/install.ts'
import { ThemeToggle } from '../ui/ThemeToggle.tsx'
import { useAccount } from './CloudApp.tsx'
import { BrandMark } from '../ui/BrandMark.tsx'
import { BuildVersion, CommitLink } from '@codefusion-cc/app-update/react'
import { BUILD } from '../lib/updates.ts'
import { MAGNETAR_REPO } from '@magnetar/protocol/cloud'

/**
 * The website's own pages (first page, sign-in, the computers, linking): the mark, Features and Sign in, or the
 * account and Sign out, and the theme, over the page, and the footer. A page that is a single question has a `narrow` column.
 */
export function CloudFrame({ children, narrow = false }: { children: ReactNode; narrow?: boolean }) {
  const t = useT()
  const { account, signOut } = useAccount()
  const install = useInstallOffer()
  const { pathname } = useLocation()
  // Signing out waits for the server; a second click meanwhile is the same sign-out.
  const [leaving, setLeaving] = useState(false)
  const leave = async () => {
    setLeaving(true)
    try {
      await signOut()
    } finally {
      setLeaving(false)
    }
  }
  return (
    <div className="site" data-narrow={narrow || undefined}>
      <header className="site-head">
        <Link to="/" className="site-brand"><BrandMark /><span>Magnetar</span></Link>
        <span className="site-grow" />
        {install && <button type="button" className="setting-link" onClick={install} title={t('install.hint')}>{t('install.button')}</button>}
        {account ? <>
          <span className="site-who" title={account.email}>{account.email}</span>
          <button type="button" className="setting-link" disabled={leaving} aria-busy={leaving} onClick={() => void leave()}>{t('cloud.signOut')}</button>
        </> : <>
          <Link to="/features" className="setting-link">{t('footer.features')}</Link>
          {pathname !== '/login' && <Link to="/login" className="setting-link">{t('cloud.signInLink')}</Link>}
        </>}
        <ThemeToggle />
      </header>
      <main className="site-main">{children}</main>
      <SiteFooter column="site-column" />
    </div>
  )
}

/** The website's footer: the build, what the app does, what's new and the source. `column` sizes its row like the page's. */
export function SiteFooter({ column }: { column: string }) {
  const t = useT()
  return (
    <footer className="site-footer">
      <div className={column}>
        <span>Magnetar <BuildVersion repo={MAGNETAR_REPO} className="tabular-nums" version={BUILD.version} />{' '}<CommitLink repo={MAGNETAR_REPO} className="site-commit" commit={BUILD.commit} /></span>
        <Link to="/features" className="setting-link">{t('footer.whatItDoes')}</Link>
        <Link to="/about" className="setting-link">{t('footer.whatsNew')}</Link>
        <a href={`https://github.com/${MAGNETAR_REPO}`} className="setting-link" target="_blank" rel="noreferrer noopener">GitHub</a>
      </div>
    </footer>
  )
}
