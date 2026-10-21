import { Spinner } from '@codefusion-cc/ui/react'
import type { ReactNode } from 'react'
import { Link, useLocation, useParams } from 'react-router'
import { useFormatRelative, useT } from '../lib/i18n.tsx'
import { MenuButton } from '../ui/Menu.tsx'
import { devicePath, samePageOn } from './devicePaths.ts'
import { useComputers } from './useComputers.ts'

/**
 * The device name in the dashboard's frame, as a menu of the account's devices: picking one opens the
 * same page on it. Each shows whether it is online and whether this browser is linked to it.
 */
export function DeviceSwitcher({ children, placement }: { children: ReactNode; placement: 'up' | 'down' }) {
  const t = useT()
  const formatRelative = useFormatRelative()
  const { deviceName = '' } = useParams()
  const { pathname, search } = useLocation()
  // Loaded up front, so the menu opens filled in; fresh again each time it opens.
  const { devices, linked, state, reload } = useComputers()

  return (
    <MenuButton label={t('devices.switch')} placement={placement} onOpen={() => reload()} className="min-w-0 flex-1"
      button={children}
      items={close => (
        <>
          <li role="none" className="infall-menu-title">{t('devices.title')}</li>
          {!devices && state === 'loading' && <li role="none" aria-busy="true" className="infall-menu-note"><Spinner /><span className="sr-only">{t('common.loading')}</span></li>}
          {state === 'failed' && <li role="none" className="infall-menu-note">{t('devices.loadFailed')}</li>}
          {devices?.map(device => {
            const current = device.name === deviceName
            return (
              <li key={device.id} role="none">
                <Link role="menuitem" to={samePageOn(pathname, search, devicePath(deviceName), devicePath(device.name))} onClick={close}
                  aria-current={current ? 'page' : undefined}>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{device.name}</span>
                    <span className="muted block truncate text-xs">
                      {device.online ? t('devices.online') : device.lastSeenAt ? t('remote.lastSeen', formatRelative(device.lastSeenAt)) : t('devices.offline')}
                      {state === 'fresh' && !linked.has(device.id) && <span className="block text-warn">{t('devices.notLinkedShort')}</span>}
                    </span>
                  </span>
                </Link>
              </li>
            )
          })}
          <li role="none" className="infall-menu-end">
            <Link role="menuitem" to="/" onClick={close}>{t('devices.back')}</Link>
          </li>
        </>
      )} />
  )
}
