import type { CloudDeviceDto } from '@magnetar/protocol/cloud'
import { Link, Navigate, useSearchParams } from 'react-router'
import { useLanguage, useT } from '../lib/i18n.tsx'
import { magnetsIn } from '../lib/magnets.ts'
import { Empty } from '../ui/Empty.tsx'
import { Loading } from '../ui/Loading.tsx'
import { CloudFrame } from './CloudFrame.tsx'
import { ComputerRow } from './ComputerRow.tsx'
import { computerLine, computerStar } from './computerLine.ts'
import { devicePath } from './devicePaths.ts'
import { useComputers } from './useComputers.ts'

/**
 * Where this browser sends magnet links once it handles them (see Your computers): straight to
 * the one linked device's add dialog, or a choice between several.
 */
export function AddRedirect() {
  const t = useT()
  const language = useLanguage()
  const [params] = useSearchParams()
  const magnet = magnetsIn(params.get('uri') ?? '')[0] ?? ''
  const { devices: all, linked, state, reload } = useComputers()

  const target = (device: CloudDeviceDto) => `${devicePath(device.name)}?add=${encodeURIComponent(magnet)}`
  if (!magnet) return <Navigate to="/" replace />
  if (state === 'loading') return <Loading screen />
  // A list that could not be read is not "no computer linked": that would send someone to link again.
  if (state === 'failed' || !all) return (
    <CloudFrame narrow>
      <Empty appearance="page" heading="h1" state="far" role="alert" title={t('devices.failedTitle')} text={t('devices.failedText')} onRetry={() => reload(false)} />
    </CloudFrame>
  )
  const devices = all.filter(d => linked.has(d.id))
  if (devices.length === 1) return <Navigate to={target(devices[0]!)} replace />
  return (
    <CloudFrame narrow>
      <Empty appearance="page" heading="h1" state={devices.length ? 'lit' : 'out'} title={t(devices.length ? 'addRedirect.choose' : 'addRedirect.none')}
        text={<span className="add-magnet">{magnet.slice(0, 160)}{magnet.length > 160 ? '…' : ''}</span>}>
        {devices.length > 0 && (
          <ul className="computers">
            {devices.map(d => (
              <ComputerRow key={d.id} name={d.name} star={computerStar(d, true)} line={computerLine(t, language, d, true, null)}>
                <Link to={target(d)} className="infall-button sm" aria-label={`${t('devices.open')}: ${d.name}`}>{t('devices.open')}</Link>
              </ComputerRow>
            ))}
          </ul>
        )}
        <p className="infall-acts"><Link to="/" className="setting-link">{t('devices.back')}</Link></p>
      </Empty>
    </CloudFrame>
  )
}

/** Asks the browser to send magnet links to this site; it confirms with the user itself. */
export function canHandleMagnets(): boolean {
  return 'registerProtocolHandler' in navigator
}

export function handleMagnetsHere(): void {
  navigator.registerProtocolHandler('magnet', `${location.origin}/add?uri=%s`)
}
