import { CircleCheck, KeyRound } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router'
import { cloud } from '../lib/cloudApi.ts'
import { errorMessage } from '../lib/errors.ts'
import { useT } from '../lib/i18n.tsx'
import { adoptParkedKey, parkedKey } from '../lib/keyStore.ts'
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
  if (typeof matchMedia !== 'function') return false
  const installed = matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true
  return !installed && matchMedia('(pointer: coarse)').matches
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

  useEffect(() => {
    if (!account || !deviceId) return
    setError(null)
    if (!parkedKey('link', deviceId)) return setError(t('link.invalid'))
    cloud.devices().then(async devices => {
      const device = devices.find(d => d.id === deviceId)
      if (!device) throw new Error(t('link.otherAccount'))
      // The parked key goes only once it is stored: a reload then tries again.
      await adoptParkedKey('link', deviceId, deviceId)
      sessionStorage.removeItem(TARGET)
      if (inBrowserTabOnATouchScreen()) setLinked(devicePath(device.name))
      else navigate(devicePath(device.name), { replace: true })
    }).catch(e => setError(errorMessage(e)))
  }, [account, deviceId, navigate, t, attempt])

  if (!account) return <Navigate to="/login?next=%2Flink" replace />
  if (linked) {
    return (
      <CloudFrame>
        <div className="surface mx-auto flex max-w-md flex-col gap-4 p-6">
          <h1 className="flex items-center gap-2 text-xl font-bold"><CircleCheck size={22} className="text-success" />{t('link.done')}</h1>
          <p className="text-sm text-base-content/70">{t('link.appHint')}</p>
          <Link to={linked} replace className="btn btn-primary w-full">{t('link.open')}</Link>
        </div>
      </CloudFrame>
    )
  }
  return (
    <CloudFrame>
      <div className="surface mx-auto flex max-w-md flex-col items-center gap-4 px-6 py-10 text-center">
        <div className="grid size-14 place-items-center rounded-box bg-primary/10 text-primary"><KeyRound size={28} /></div>
        <h1 className="text-2xl font-bold">{t('link.title')}</h1>
        {error || !deviceId
          ? <div role="alert" className="alert alert-error alert-soft w-full text-sm">{error ?? t('link.invalid')}</div>
          : <span className="loading loading-spinner loading-lg text-primary" />}
        {/* Only a key still parked can be stored on a second try; without one, a new link is needed. */}
        {error && deviceId && parkedKey('link', deviceId) && (
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setAttempt(n => n + 1)}>{t('common.retry')}</button>
        )}
      </div>
    </CloudFrame>
  )
}
