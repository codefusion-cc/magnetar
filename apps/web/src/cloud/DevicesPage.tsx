import type { CloudDeviceDto } from '@magnetar/protocol/cloud'
import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { cloud } from '../lib/cloudApi.ts'
import { errorMessage } from '../lib/errors.ts'
import { useLanguage, useT } from '../lib/i18n.tsx'
import { forgetDevicePreferences } from '../lib/browserStorage.ts'
import { forgetDeviceKey } from '../lib/keyStore.ts'
import { latestRelease } from '../lib/releases.ts'
import { Empty } from '../ui/Empty.tsx'
import { Loading } from '../ui/Loading.tsx'
import { ConfirmDialog } from '../ui/Modal.tsx'
import { useToast } from '../ui/toast.tsx'
import { canHandleMagnets, handleMagnetsHere } from './AddRedirect.tsx'
import { CloudFrame } from './CloudFrame.tsx'
import { ComputerRow } from './ComputerRow.tsx'
import { computerLine, computerStar } from './computerLine.ts'
import { devicePath } from './devicePaths.ts'
import { DownloadApp, useGetApp } from './DownloadApp.tsx'
import { useComputers } from './useComputers.ts'

/** `/` signed in: the account's computers, each with how it is and the way to open or link it. */
export function DevicesPage() {
  const t = useT()
  const language = useLanguage()
  const toast = useToast()
  const { devices, linked, state, reload, setDevices } = useComputers()
  const [removing, setRemoving] = useState<CloudDeviceDto | null>(null)
  const latest = latestRelease.useLatest()

  // Online stars stay current while the page is looked at; a hidden tab doesn't ask.
  useEffect(() => {
    const timer = setInterval(() => { if (!document.hidden) reload() }, 15_000)
    const visible = () => { if (!document.hidden) reload() }
    document.addEventListener('visibilitychange', visible)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', visible)
    }
  }, [reload])

  return (
    <CloudFrame>
      <div className="site-page">
        <h1>{t('devices.title')}</h1>
        {state === 'loading' ? (
          <Loading rows={2} text={t('devices.loading')} />
        ) : state === 'failed' || !devices ? (
          <Empty appearance="page" state="far" role="alert" title={t('devices.failedTitle')} text={t('devices.failedText')} onRetry={() => reload(false)} />
        ) : devices.length === 0 ? (
          <Empty appearance="page" state="out" title={t('devices.emptyTitle')} text={t('devices.emptyHint')}>
            <DownloadApp />
          </Empty>
        ) : (
          <>
            <ul className="computers">
              {devices.map(device => {
                const hasKey = linked.has(device.id)
                const open = hasKey ? t('devices.open') : t('devices.link')
                return (
                  <ComputerRow key={device.id} name={device.name} star={computerStar(device, hasKey)}
                    line={computerLine(t, language, device, hasKey, latest?.version ?? null)}>
                    <Link to={devicePath(device.name)} className={`infall-button sm${hasKey && device.online ? '' : ' quiet'}`} aria-label={`${open}: ${device.name}`}>{open}</Link>
                    <button type="button" className="setting-link computer-remove" aria-label={`${t('devices.remove')}: ${device.name}`} onClick={() => setRemoving(device)}>{t('devices.remove')}</button>
                  </ComputerRow>
                )
              })}
            </ul>
            <AddComputer />
            {canHandleMagnets() && linked.size > 0 && (
              <div className="site-banner">
                <p>{t('devices.magnetsHint')}</p>
                <button type="button" className="infall-small sm" onClick={() => { handleMagnetsHere(); toast(t('devices.magnetsAsked'), 'info') }}>{t('devices.magnetsButton')}</button>
              </div>
            )}
          </>
        )}
      </div>
      <ConfirmDialog open={removing !== null} title={t('devices.removeTitle')} message={t('devices.removeConfirm', removing?.name ?? '')}
        options={[{ label: t('common.cancel'), value: false, tone: 'ghost' }, { label: t('devices.remove'), value: true, tone: 'error' }]}
        onResult={async confirmed => {
          const device = removing
          setRemoving(null)
          if (!confirmed || !device) return
          try {
            await cloud.removeDevice(device.id)
            // Gone from the list at once, also when reading the list again fails.
            setDevices(list => list?.filter(d => d.id !== device.id) ?? list)
            await forgetDeviceKey(device.id).catch(() => {})
            forgetDevicePreferences(device.name)
            reload()
          } catch (e) {
            toast(errorMessage(e), 'error')
          }
        }} />
    </CloudFrame>
  )
}

/** Under the list: how to add another computer, with the app for this one's system. */
function AddComputer() {
  const t = useT()
  const { button } = useGetApp('infall-small sm')
  return (
    <div className="site-add">
      <p className="fine">{t('devices.addHint')}</p>
      {button}
    </div>
  )
}
