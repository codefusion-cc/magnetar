import type { CloudDeviceDto } from '@magnetar/protocol/cloud'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Link, useLocation, useParams } from 'react-router'
import { cloud } from '../lib/cloudApi.ts'
import { useFormatRelative, useT } from '../lib/i18n.tsx'
import { listDeviceKeys } from '../lib/keyStore.ts'
import { MenuButton } from '../ui/Menu.tsx'
import { devicePath, samePageOn } from './devicePaths.ts'

/**
 * The device name in the dashboard's frame, as a menu of the account's devices: picking one opens the
 * same page on it. Each shows whether it is online and whether this browser is linked to it.
 */
export function DeviceSwitcher({ children, placement }: { children: ReactNode; placement: 'up' | 'down' }) {
  const t = useT()
  const formatRelative = useFormatRelative()
  const { deviceName = '' } = useParams()
  const { pathname, search } = useLocation()
  const [devices, setDevices] = useState<CloudDeviceDto[] | null>(null)
  const [linked, setLinked] = useState<Set<string>>(new Set())
  const [failed, setFailed] = useState(false)

  const load = useCallback(async () => {
    try {
      const [list, keys] = await Promise.all([cloud.devices(), listDeviceKeys().catch(() => [])])
      setDevices(list)
      setLinked(new Set(keys.map(k => k.deviceId)))
      setFailed(false)
    } catch {
      setFailed(true)
    }
  }, [])
  // Loaded up front, so the menu opens filled in; fresh again each time it opens.
  useEffect(() => void load(), [load])

  return (
    <MenuButton label={t('devices.switch')} placement={placement} onOpen={() => void load()} className="min-w-0 flex-1"
      button={children}
      items={close => (
        <>
          <li className="menu-title">{t('devices.title')}</li>
          {devices === null && !failed && <li aria-busy="true" className="px-3 py-2"><span className="loading loading-dots loading-sm" /></li>}
          {failed && <li role="none" className="muted px-3 py-2 text-sm">{t('devices.loadFailed')}</li>}
          {devices?.map(device => {
            const current = device.name === deviceName
            return (
              <li key={device.id} role="none">
                <Link role="menuitem" to={samePageOn(pathname, search, devicePath(deviceName), devicePath(device.name))} onClick={close}
                  aria-current={current ? 'page' : undefined} className={`flex items-center gap-3 ${current ? 'menu-active' : ''}`}>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{device.name}</span>
                    <span className="muted block truncate text-xs">
                      {device.online ? t('devices.online') : device.lastSeenAt ? t('remote.lastSeen', formatRelative(device.lastSeenAt)) : t('devices.offline')}
                      {!linked.has(device.id) && <span className="block text-warning">{t('devices.notLinkedShort')}</span>}
                    </span>
                  </span>
                </Link>
              </li>
            )
          })}
          <li role="none" className="mt-1 border-t border-base-300 pt-1">
            <Link role="menuitem" to="/" onClick={close}>{t('devices.back')}</Link>
          </li>
        </>
      )} />
  )
}
