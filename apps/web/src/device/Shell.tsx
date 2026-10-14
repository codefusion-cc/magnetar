import { Check, ExternalLink } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { Link, NavLink, Outlet } from 'react-router'
import { featuresUrl } from '../lib/featuresLink.ts'
import { deviceStar } from '../lib/deviceStar.ts'
import { Star } from '../ui/Star.tsx'
import { expectsAway } from '../lib/updateInstall.ts'
import { useLanguage, useT } from '../lib/i18n.tsx'
import { Loading } from '../ui/Loading.tsx'
import { useDevice, useDownloads, useSearchLink } from './DeviceContext.tsx'
import { isActive } from './components/downloads.tsx'
import { BrandMark } from '../ui/BrandMark.tsx'
import { MenuButton } from '../ui/Menu.tsx'
import { BuildVersion, CommitLink } from '@codefusion-cc/app-update/react'
import { MAGNETAR_REPO } from '@magnetar/protocol/cloud'
import { BUILD } from '../lib/updates.ts'
import { UpdateBanner } from './UpdateBanner.tsx'

/** Wraps the device's name in a way to reach the account's other devices; `placement` is where it opens. */
export type DeviceMenu = (label: ReactNode, placement: 'up' | 'down') => ReactNode

/**
 * The dashboard frame. Wide screens get one top row; phones keep the places at the bottom, within thumb reach.
 * The device's name opens `deviceMenu`, or, on
 * this computer's own dashboard once it is on an account, a link to the account's other devices.
 */
export function Shell({ headerStart, headerEnd, deviceMenu }: { headerStart?: ReactNode; headerEnd?: ReactNode; deviceMenu?: DeviceMenu }) {
  const t = useT()
  const { basePath, info, connectionState, connection, remote } = useDevice()
  const menu = deviceMenu ?? (connection.kind === 'local' && remote?.paired ? localDeviceMenu(remote.cloudUrl, t) : undefined)
  const active = useDownloads().filter(isActive).length
  const searchLink = useSearchLink()

  const nav = [
    { to: basePath || '/', end: true, label: t('nav.downloads'), count: active },
    { to: searchLink, end: false, label: t('nav.search') },
    { to: `${basePath}/series`, end: false, label: t('nav.series') },
    { to: `${basePath}/files`, end: false, label: t('nav.files') },
    { to: `${basePath}/settings`, end: false, label: t('nav.settings') },
  ]

  return (
    <div className="pb-tabbar flex min-h-screen min-w-0 flex-col bg-page text-ink">
      <header className={`shell-header${headerStart || headerEnd ? ' shell-header-controls' : ''}`}>
        <div className="flex min-w-0 items-center gap-2">
          {headerStart}
          <Brand />
        </div>
        <nav aria-label={t('nav.menu')} className="shell-nav">
          {nav.map(item => (
            <NavLink key={item.to} to={item.to} end={item.end} className="shell-tab">
              <span className="shell-tab-label">{item.label}</span>
              {!!item.count && <span className="shrink-0 tabular-nums">{item.count}</span>}
            </NavLink>
          ))}
        </nav>
        <div className="shell-device flex min-w-0 items-center gap-2">
          <DeviceStatus menu={menu} />
          {headerEnd}
        </div>
      </header>
      <ConnectionBanner />
      <UpdateBanner />
      <main className="shell-column w-full min-w-0 flex-1 pt-5">
        {connectionState.status === 'open' || info ? <Outlet /> : <Loading />}
      </main>
      {info && <footer className="shell-column w-full py-6"><Builds /></footer>}
    </div>
  )
}

/** Which builds this dashboard is: the app's (its About on a click) and, on the website, the website's. */
function Builds() {
  const t = useT()
  const { info, basePath, connection } = useDevice()
  const language = useLanguage()
  if (!info) return null
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-muted">
      <span>
        <Link to={`${basePath}/settings/about`} className="hover:underline" title={t('settings.section.about')}>Magnetar</Link>
        {' '}<BuildVersion repo={MAGNETAR_REPO} className="tabular-nums" version={info.version} />{' '}<CommitLink repo={MAGNETAR_REPO} className="font-mono hover:underline" commit={info.commit} />
      </span>
      <a href={featuresUrl(language)} className="hover:underline" target="_blank" rel="noreferrer noopener">{t('footer.features')}</a>
      {connection.kind === 'remote' && <span>{t('shell.website')} <BuildVersion repo={MAGNETAR_REPO} className="tabular-nums" version={BUILD.version} />{' '}<CommitLink repo={MAGNETAR_REPO} className="font-mono hover:underline" commit={BUILD.commit} /></span>}
    </div>
  )
}

function Brand() {
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <BrandMark />
      <span className="truncate font-display text-[15px]">Magnetar</span>
    </div>
  )
}

/** On this computer's own dashboard: this computer, and the website for the account's other devices. */
function localDeviceMenu(cloudUrl: string, t: ReturnType<typeof useT>): DeviceMenu {
  return (label, placement) => (
    <MenuButton label={t('devices.switch')} placement={placement} className="min-w-0 flex-1" button={label}
      items={close => (
        <>
          <li role="none">
            <a role="menuitem" href="/" aria-current="page" className="font-semibold" onClick={event => { event.preventDefault(); close() }}>
              <span className="flex-1">{t('shell.thisComputer')}</span><Check size={16} aria-hidden />
            </a>
          </li>
          <li role="none">
            <a role="menuitem" href={cloudUrl} target="_blank" rel="noopener" onClick={close}>
              <span className="flex-1">{t('devices.others')}</span><ExternalLink size={14} aria-hidden />
            </a>
          </li>
        </>
      )} />
  )
}

/** Which device this is and whether it is reachable; with a menu, also the way to the others. */
function DeviceStatus({ menu }: { menu?: DeviceMenu }) {
  const t = useT()
  const { deviceName, connection, connectionState, installPhase } = useDevice()
  const light = deviceStar(connectionState, installPhase)
  const where = connection.kind === 'remote' ? t('remote.viaRelay') : t('shell.thisComputer')
  const status = connectionState.status === 'open' ? where
    : expectsAway(installPhase) ? t('settings.installing')
    : connectionState.status === 'rejected' ? t(connectionState.reason)
    : light === 'out' ? t('devices.offline')
    : t('connection.reconnecting')
  const label = (
    <span className={`flex min-w-0 items-center gap-2 py-2 ${menu ? 'rounded-ctl hover:bg-raised' : ''}`}>
      <span className="grid size-8 shrink-0 place-items-center"><Star state={light} /></span>
      <span className="min-w-0 flex-1 leading-tight">
        <span className="block truncate text-[15px] font-semibold">{deviceName}</span>
        <span className="shell-device-detail mt-0.5 block truncate text-[13px] text-muted">{status}</span>
      </span>
    </span>
  )
  return menu ? menu(label, 'down') : <div className="min-w-0 flex-1">{label}</div>
}

function ConnectionBanner() {
  const t = useT()
  const { connectionState, installPhase } = useDevice()
  const [visible, setVisible] = useState(false)
  // Brief reconnects are normal; only mention them if they last.
  useEffect(() => {
    if (connectionState.status === 'open') return setVisible(false)
    const timer = setTimeout(() => setVisible(true), connectionState.status === 'connecting' ? 1500 : 400)
    return () => clearTimeout(timer)
  }, [connectionState])
  // An app that restarts to update is away on purpose: the update's own notice says so, until it has waited too long.
  if (!visible || connectionState.status === 'open' || connectionState.status === 'closed' || expectsAway(installPhase)) return null

  const text = connectionState.status === 'device-offline' ? t('remote.deviceOffline')
    : connectionState.status === 'rejected' ? t(connectionState.reason)
    : connectionState.status === 'reconnecting' ? t('connection.reconnecting')
    : t('connection.connecting')
  return (
    <div className="shell-column w-full pt-4">
      <p role="alert" className={connectionState.status === 'rejected' ? 'text-danger' : 'text-muted'}>{text}</p>
    </div>
  )
}
