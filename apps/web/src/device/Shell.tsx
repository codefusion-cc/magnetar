import { useEffect, useState, type ReactNode } from 'react'
import { Link, matchPath, Outlet, useLocation } from 'react-router'
import { isActive, isFinished } from '../lib/downloadViews.ts'
import { deviceStar } from '../lib/deviceStar.ts'
import { Star } from '../ui/Star.tsx'
import { useT } from '../lib/i18n.tsx'
import { useDevice, useDownloads, useDownloadRead, useSearchLink } from './DeviceContext.tsx'
import { BrandMark } from '../ui/BrandMark.tsx'
import { MenuButton } from '../ui/Menu.tsx'
import { ThemeToggle } from '../ui/ThemeToggle.tsx'
import { UpdateBanner } from './UpdateBanner.tsx'
import { AwayScreen, useAway, type Away } from './AwayScreen.tsx'

/** Wraps the device's name in a way to reach the account's other devices; `placement` is where it opens. */
export type DeviceMenu = (label: ReactNode, placement: 'up' | 'down') => ReactNode

/**
 * The dashboard frame. Wide screens get one top row; phones keep the places at the bottom, within thumb reach. The
 * computer and the theme switch end the top row on both.
 * The device's name opens `deviceMenu`, or, on
 * this computer's own dashboard once it is on an account, a link to the account's other devices.
 */
export function Shell({ deviceMenu }: { deviceMenu?: DeviceMenu }) {
  const t = useT()
  const { basePath, connection, remote, deviceName } = useDevice()
  const menu = deviceMenu ?? (connection.kind === 'local' && remote?.paired ? localDeviceMenu(remote.cloudUrl, t) : undefined)
  const active = useDownloads().filter(d => isActive(d) && !isFinished(d)).length
  const searchLink = useSearchLink()
  const { pathname } = useLocation()
  // While the computer is away the page shows nothing of it, the count of its downloads included.
  const away = useAway()

  const nav = [
    { to: basePath || '/', routes: [basePath || '/', `${basePath}/downloads/:id`], label: t('nav.downloads'), count: away ? 0 : active },
    { to: searchLink, routes: [`${basePath}/search/*`], label: t('nav.search') },
    { to: `${basePath}/series`, routes: [`${basePath}/series/:tab?`], label: t('nav.series') },
    { to: `${basePath}/files`, routes: [`${basePath}/files`], label: t('nav.files') },
    { to: `${basePath}/settings`, routes: [`${basePath}/settings/:section?`], label: t('nav.settings') },
  ]

  return (
    <div className="pb-tabbar flex min-h-screen min-w-0 flex-col bg-page text-ink">
      <header className="shell-header">
        <div className="flex min-w-0 items-center gap-2">
          <Brand />
        </div>
        <nav aria-label={t('nav.menu')} className="shell-nav">
          {nav.map(item => <Link key={item.to} to={item.to} className="shell-tab"
            aria-current={item.routes.some(path => matchPath({ path, end: true }, pathname)) ? 'page' : undefined}>
            <span className="shell-tab-label">{item.label}</span>
            {!!item.count && <span className="shrink-0 tabular-nums">{item.count}</span>}
          </Link>)}
        </nav>
        <div className="shell-end">
          <div role="group" aria-label={deviceName} className="shell-device flex min-w-0 items-center gap-2">
            <DeviceStatus menu={menu} />
          </div>
          <ThemeToggle />
        </div>
      </header>
      <ConnectionBanner away={away} />
      <main tabIndex={-1} className="shell-column w-full min-w-0 flex-1 shell-main">
        <UpdateBanner />
        {away ? <AwayScreen key={away} away={away} /> : <Outlet />}
      </main>
    </div>
  )
}

function Brand() {
  const { connection } = useDevice()
  const brand = (
    <div className="flex min-w-0 items-center gap-1.5">
      <BrandMark />
      <span className="truncate font-display text-[15px]">Magnetar</span>
    </div>
  )
  return connection.kind === 'remote' ? <Link to="/" aria-label="Magnetar">{brand}</Link> : brand
}

/** On this computer's own dashboard: this computer, and the website for the account's other devices. */
function localDeviceMenu(cloudUrl: string, t: ReturnType<typeof useT>): DeviceMenu {
  return (label, placement) => (
    <MenuButton label={t('devices.switch')} placement={placement} className="min-w-0 flex-1" button={label}
      items={close => (
        <>
          <li role="none">
            <a role="menuitem" href="/" aria-current="page" className="font-semibold" onClick={event => { event.preventDefault(); close() }}>
              <span className="flex-1">{t('shell.thisComputer')}</span>
            </a>
          </li>
          <li role="none">
            <a role="menuitem" href={cloudUrl} target="_blank" rel="noopener" onClick={close}>
              <span className="flex-1">{t('devices.others')}</span>
            </a>
          </li>
        </>
      )} />
  )
}

/** Which device this is and whether it is reachable; with a menu, also the way to the others. */
function DeviceStatus({ menu }: { menu?: DeviceMenu }) {
  const t = useT()
  const { deviceName, connection, connectionState } = useDevice()
  const light = deviceStar(connectionState)
  const where = connection.kind === 'remote' ? t('remote.viaRelay') : t('shell.thisComputer')
  const status = connectionState.status === 'open' ? where
    : connectionState.status === 'rejected' ? t(connectionState.reason)
    : light === 'out' ? t('shell.notReachable')
    : t('connection.reconnecting')
  const label = (
    <span className={`flex min-w-0 items-center gap-[10px] ${menu ? 'rounded-ctl hover:bg-raised' : ''}`}>
      <span className="grid size-[26px] shrink-0 place-items-center"><Star state={light} /></span>
      <span className="min-w-0 flex-1 leading-tight">
        <span className="block truncate text-[15px] font-semibold">{deviceName}</span>
        <span className="shell-device-detail mt-0.5 block truncate text-[13px] text-muted">{status}</span>
      </span>
    </span>
  )
  return menu ? menu(label, 'down') : <div className="min-w-0 flex-1">{label}</div>
}

/** A connection that is not open, said once it lasts; an offline computer and an update's restart have their screens. */
function ConnectionBanner({ away }: { away: Away | null }) {
  const t = useT()
  const { connectionState, info, basePath } = useDevice()
  const read = useDownloadRead()
  const { pathname } = useLocation()
  const initialDownloads = read.loading && !info && connectionState.status !== 'rejected' && pathname === (basePath || '/')
  const [visible, setVisible] = useState(false)
  // Brief reconnects are normal; only mention them if they last.
  useEffect(() => {
    if (connectionState.status === 'open') return setVisible(false)
    const timer = setTimeout(() => setVisible(true), connectionState.status === 'connecting' ? 1500 : 400)
    return () => clearTimeout(timer)
  }, [connectionState])
  if (initialDownloads || !visible || away || ['open', 'closed', 'device-offline'].includes(connectionState.status)) return null

  const text = connectionState.status === 'rejected' ? t(connectionState.reason)
    : connectionState.status === 'reconnecting' ? t('connection.reconnecting')
    : t('connection.connecting')
  return (
    <div className="shell-column w-full pt-4">
      <p role="alert" className={connectionState.status === 'rejected' ? 'text-danger' : 'text-muted'}>{text}</p>
    </div>
  )
}
