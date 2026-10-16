import { useEffect, useRef, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router'
import { cloud } from '../lib/cloudApi.ts'
import { errorMessage } from '../lib/errors.ts'
import { useT } from '../lib/i18n.tsx'
import { isInstalledApp } from '../lib/installedApp.ts'
import { adoptParkedKey, parkedKey } from '../lib/keyStore.ts'
import { linkWithKey } from '../lib/linkDevice.ts'
import { Empty } from '../ui/Empty.tsx'
import { Loading } from '../ui/Loading.tsx'
import { useAccount } from './CloudApp.tsx'
import { CloudFrame } from './CloudFrame.tsx'
import { captureFragmentKey } from './PairPage.tsx'
import { devicePath } from './devicePaths.ts'

const TARGET = 'magnetar-link-device'

/**
 * Whether this is a phone's or tablet's browser tab rather than an installed web app. The camera app opens a scanned
 * link in the browser, whose storage an installed app does not share, so only the app itself can be linked from
 * inside it (see NotLinked). Only there the person is told so.
 */
function inBrowserTabOnATouchScreen(): boolean {
  return typeof matchMedia === 'function' && !isInstalledApp() && matchMedia('(pointer: coarse)').matches
}

/** Opened from a QR code shown by the device or a linked browser: stores the key it carries. */
export function LinkPage() {
  const t = useT()
  const navigate = useNavigate()
  const { account } = useAccount()
  const [deviceId] = useState(() => {
    captureFragmentKey('link', params => {
      const id = params.get('d')
      if (id) sessionStorage.setItem(TARGET, id)
      return id
    })
    return sessionStorage.getItem(TARGET)
  })
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [linked, setLinked] = useState<string | null>(null)
  // The parked key is gone once stored, so a run started while another is still asking the device would call a
  // good link invalid.
  const working = useRef(false)

  useEffect(() => {
    if (!account || !deviceId || working.current) return
    setError(null)
    const parked = parkedKey('link', deviceId)
    if (!parked) return setError(t('link.invalid'))
    working.current = true
    cloud.devices().then(async devices => {
      const device = devices.find(d => d.id === deviceId)
      if (!device) throw new Error(t('link.otherAccount'))
      // The parked key goes only once it is stored: a reload then tries again.
      await adoptParkedKey('link', deviceId, deviceId)
      sessionStorage.removeItem(TARGET)
      // "Linked" is said only once the device has accepted the key, which is also what spends the link: said
      // before, a code typed into the app meanwhile would take the link and leave this tab with a dead key.
      // Whatever else happens shows on the device's page, as it does without the note about the app.
      if (inBrowserTabOnATouchScreen() && await linkWithKey(deviceId, parked.keyId, parked.key) === 'linked') setLinked(devicePath(device.name))
      else navigate(devicePath(device.name), { replace: true })
    }).catch(e => setError(errorMessage(e))).finally(() => { working.current = false })
  }, [account, deviceId, navigate, t, attempt])

  if (!account) return <Navigate to="/login?next=%2Flink" replace />
  if (linked) {
    return (
      <CloudFrame narrow>
        <Empty appearance="page" heading="h1" title={t('link.done')} text={t('link.appHint')}>
          <div className="infall-acts"><Link to={linked} replace className="infall-button">{t('link.open')}</Link></div>
        </Empty>
      </CloudFrame>
    )
  }
  const failed = error ?? (deviceId ? null : t('link.invalid'))
  return (
    <CloudFrame narrow>
      {failed ? (
        // Only a key still parked can be stored on a second try; without one, a new link is needed.
        <Empty appearance="page" heading="h1" state="far" role="alert" title={t('link.failedTitle')} text={failed}
          onRetry={deviceId && parkedKey('link', deviceId) ? () => setAttempt(n => n + 1) : undefined} />
      ) : <Loading text={t('link.title')} />}
    </CloudFrame>
  )
}
