import { useTheme } from '@codefusion-cc/theme/react'
import type { ReactNode } from 'react'
import { Link, NavLink } from 'react-router'
import { useT } from '../lib/i18n.tsx'
import { useInstallOffer } from '../lib/install.ts'
import { theme } from '../ui/theme.ts'
import { useAccount } from './CloudApp.tsx'
import { BrandMark } from '../ui/BrandMark.tsx'
import { MenuButton } from '../ui/Menu.tsx'
import { BuildVersion, CommitLink } from '@codefusion-cc/app-update/react'
import { BUILD } from '../lib/updates.ts'
import { MAGNETAR_REPO } from '@magnetar/protocol/cloud'

/** The website's own pages (sign-in, device list, pairing): a slim header over a centred column. */
export function CloudFrame({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  const t = useT()
  const { account } = useAccount()
  const install = useInstallOffer()
  return (
    <div className="flex min-h-screen flex-col bg-page text-ink">
      <header className="border-b border-line bg-page">
        <div className={`cloud-header mx-auto flex min-h-16 w-full flex-wrap items-center gap-2 px-4 py-3 ${wide ? 'max-w-5xl' : 'max-w-3xl'}`}>
          <Link to="/" className="mr-auto flex min-h-10 items-center gap-1.5 rounded-ctl">
            <BrandMark />
            <span className="font-display text-[15px]">Magnetar</span>
          </Link>
          {install && (
            <button type="button" className="frame-control" onClick={install} aria-label={t('install.button')} title={t('install.hint')}>
              {t('install.button')}
            </button>
          )}
          {account && <AccountMenu />}
          <ThemeToggle />
        </div>
      </header>
      <main className={`mx-auto w-full flex-1 px-4 py-8 sm:py-12 ${wide ? 'max-w-5xl' : 'max-w-3xl'}`}>{children}</main>
    </div>
  )
}

/** The website's footer: the build, the features, what's new and the source. `column` sizes its row like the page's. */
export function SiteFooter({ column }: { column: string }) {
  const t = useT()
  return (
    <footer className="border-t border-line">
      <div className={`flex flex-wrap items-center gap-x-4 gap-y-1 py-4 text-[13px] text-muted ${column}`}>
        <span>Magnetar <BuildVersion repo={MAGNETAR_REPO} className="tabular-nums" version={BUILD.version} />{' '}<CommitLink repo={MAGNETAR_REPO} className="font-mono hover:underline" commit={BUILD.commit} /></span>
        <NavLink to="/features" className="hover:underline">{t('footer.features')}</NavLink>
        <Link to="/about" className="hover:underline">{t('footer.whatsNew')}</Link>
        <a href={`https://github.com/${MAGNETAR_REPO}`} className="hover:underline" target="_blank" rel="noreferrer noopener">GitHub</a>
      </div>
    </footer>
  )
}

/** Light or dark, the other one than shown, for this browser. */
export function ThemeToggle() {
  const t = useT()
  const { resolved } = useTheme(theme)
  const next = resolved === 'dark' ? 'light' : 'dark'
  return (
    // The sun or the moon of the mode it switches to: a bare "Light" on a dark page reads as the mode it is in.
    <button type="button" className="frame-control" onClick={theme.toggle} aria-label={t(`theme.${next}`)} title={t(`theme.${next}`)}>
      {t(`theme.${next}`)}
    </button>
  )
}

export function AccountMenu() {
  const t = useT()
  const { account, signOut } = useAccount()
  if (!account) return null
  return (
    <MenuButton label={account.email} className="frame-account w-10 shrink-0" button={
      <span className="frame-control frame-square">
        {account.picture
          ? <img src={account.picture} alt="" className="size-7 rounded-ctl" referrerPolicy="no-referrer" />
          : <span aria-hidden="true" className="text-sm font-semibold">{account.email[0]?.toUpperCase()}</span>}
      </span>
    } items={close => (
      <>
        <li role="none" className="break-all px-3 py-2 text-[13px] text-muted">{account.email}</li>
        <li role="none"><Link role="menuitem" to="/about" onClick={close}>{t('footer.whatsNew')}</Link></li>
        <li role="none"><button role="menuitem" type="button" onClick={() => { close(); void signOut() }}>{t('cloud.signOut')}</button></li>
      </>
    )} />
  )
}
