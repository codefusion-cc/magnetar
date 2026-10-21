import type { CloudDeviceDto } from '@magnetar/protocol/cloud'
import { sameDeviceName } from '@magnetar/protocol/device-name'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router'
import { DeviceProvider, useDevice } from '../device/DeviceContext.tsx'
import { DeviceRoutes } from '../device/DeviceRoutes.tsx'
import { cloud } from '../lib/cloudApi.ts'
import { useLanguage, useT } from '../lib/i18n.tsx'
import { getDeviceKey, type StoredDeviceKey } from '../lib/keyStore.ts'
import { RelayConnection } from '../lib/relayConnection.ts'
import { Empty } from '../ui/Empty.tsx'
import { Loading } from '../ui/Loading.tsx'
import { CloudFrame } from './CloudFrame.tsx'
import { deviceIdPath, devicePath, samePageOn } from './devicePaths.ts'
import { DeviceSwitcher } from './DeviceSwitcher.tsx'
import { NotLinked } from './NotLinked.tsx'
import { useComputers } from './useComputers.ts'

/** What to show while the device an address names is not known: loading, a failed list, or no such device. */
function DeviceLookup({ devices, state, reload, name }: ReturnType<typeof useComputers> & { name: string }) {
  const t = useT()
  if (state === 'failed') {
    return (
      <CloudFrame narrow>
        <Empty appearance="page" heading="h1" state="far" role="alert" title={t('devices.failedTitle')} text={t('devices.failedText')} onRetry={() => reload(false)} />
      </CloudFrame>
    )
  }
  // A list from before this visit may predate a rename: only a fresh one may say the device is not there.
  if (!devices || state !== 'fresh') return <Loading screen />
  return (
    <CloudFrame narrow>
      <Empty appearance="page" heading="h1" state="out" title={t('devices.notFoundTitle', name)} text={t('devices.notFoundHint')}>
        {devices.length > 0 && <ul className="site-picks">{devices.map(d => <li key={d.id}><Link to={devicePath(d.name)} className="setting-link">{d.name}</Link></li>)}</ul>}
        <p className="infall-acts"><Link to="/" className="setting-link">{t('devices.back')}</Link></p>
      </Empty>
    </CloudFrame>
  )
}

/** `/d/<device id>/…`: the same page under the device's name, which is what the address bar should show. */
export function DeviceIdRedirect() {
  const { deviceId = '' } = useParams()
  const { pathname, search, hash } = useLocation()
  const list = useComputers(deviceId)
  const device = list.devices?.find(d => d.id === deviceId)
  if (!device) return <DeviceLookup {...list} name={deviceId} />
  return <Navigate replace to={samePageOn(pathname, search, deviceIdPath(deviceId), devicePath(device.name)) + hash} />
}

/** A device's dashboard through the relay, end-to-end encrypted with this browser's key, found by its name. */
export function RemoteDevice() {
  const { deviceName = '' } = useParams()
  const { pathname, search, hash } = useLocation()
  // Names match in any case, so moving to the device's own spelling is not another device.
  const list = useComputers(deviceName.toLowerCase())
  const { setDevices } = list
  const device = list.devices?.find(d => sameDeviceName(d.name, deviceName))
  // The app was renamed while its page is open: the list learns the name, and the address follows.
  const renamed = useCallback((id: string, name: string) => setDevices(all => all?.map(d => (d.id === id ? { ...d, name } : d)) ?? all), [setDevices])
  if (!device) return <DeviceLookup {...list} name={deviceName} />
  // Names match in any case; the address shows the device's own spelling.
  if (device.name !== deviceName) return <Navigate replace to={samePageOn(pathname, search, devicePath(deviceName), devicePath(device.name)) + hash} />
  // Keyed by device: switching to another starts clean, with nothing of the last one's key, connection or state.
  return <DeviceView key={device.id} device={device} onRenamed={renamed} />
}

function DeviceView({ device, onRenamed }: { device: CloudDeviceDto; onRenamed: (id: string, name: string) => void }) {
  const [key, setKey] = useState<StoredDeviceKey | null | undefined>(undefined)
  const [connection, setConnection] = useState<RelayConnection | null>(null)
  // Until the device's settings name its language, its pages are in the website's.
  const siteLanguage = useLanguage()

  useEffect(() => {
    let cancelled = false
    void getDeviceKey(device.id).catch(() => undefined).then(k => !cancelled && setKey(k ?? null))
    return () => { cancelled = true }
  }, [device.id])

  useEffect(() => {
    if (!key) return
    const relay = new RelayConnection(device.id, key)
    setConnection(relay)
    return () => relay.close()
  }, [device.id, key])

  if (key === undefined) return <Loading screen />
  if (key === null) {
    return (
      <CloudFrame narrow>
        <NotLinked device={device} onLinked={() => void getDeviceKey(device.id).then(k => setKey(k ?? null), () => {})} />
      </CloudFrame>
    )
  }
  if (!connection) return null

  return (
    <DeviceProvider connection={connection} basePath={devicePath(device.name)} deviceName={device.name}>
      <FollowRename device={device} onRenamed={onRenamed} />
      <DeviceRoutes fallbackLanguage={siteLanguage}
        deviceMenu={(label, placement) => <DeviceSwitcher placement={placement}>{label}</DeviceSwitcher>} />
    </DeviceProvider>
  )
}

/**
 * Moves the address to the device's new name when the app says it was renamed, keeping the page and its connection.
 * The account's list has the last word: an app from before names were addresses may still call itself by a name the
 * account gave another device.
 */
function FollowRename({ device, onRenamed }: { device: CloudDeviceDto; onRenamed: (id: string, name: string) => void }) {
  const { remote } = useDevice()
  const navigate = useNavigate()
  const location = useLocation()
  const here = useRef(location)
  here.current = location
  const reported = remote?.deviceName
  useEffect(() => {
    if (!reported || reported === device.name) return
    let cancelled = false
    void cloud.devices().then(list => {
      const name = list.find(d => d.id === device.id)?.name
      if (cancelled || !name || name === device.name) return
      const { pathname, search, hash } = here.current
      onRenamed(device.id, name)
      navigate(samePageOn(pathname, search, devicePath(device.name), devicePath(name)) + hash, { replace: true })
    }, () => {})
    return () => { cancelled = true }
  }, [reported])
  return null
}
