import type { PairApproveResponse, PairingInfoDto } from '@magnetar/protocol/cloud'
import { base64UrlToBytes } from '@codefusion-cc/workers-crypto'
import { useEffect, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router'
import { cloud } from '../lib/cloudApi.ts'
import { errorMessage } from '../lib/errors.ts'
import { useLanguage, useT } from '../lib/i18n.tsx'
import { adoptParkedKey, parkKey, parkedKey } from '../lib/keyStore.ts'
import { Empty } from '../ui/Empty.tsx'
import { Loading } from '../ui/Loading.tsx'
import { useAccount } from './CloudApp.tsx'
import { CloudFrame } from './CloudFrame.tsx'
import { ComputerRow } from './ComputerRow.tsx'
import { computerLine } from './computerLine.ts'
import { devicePath } from './devicePaths.ts'

/** Reads a key from `#i=<keyId>&k=<key>` into session storage and drops it from the address bar. */
export function captureFragmentKey(kind: 'pair' | 'link', target: (params: URLSearchParams) => string | null): void {
  const params = new URLSearchParams(location.hash.slice(1))
  const keyId = params.get('i')
  const key = params.get('k')
  const id = target(params)
  if (!keyId || !key || !id) return
  history.replaceState(history.state, '', location.pathname + location.search)
  const raw = base64UrlToBytes(key)
  // A mangled link: pairing still works, this browser just won't be linked.
  if (raw?.length === 32) parkKey(kind, id, keyId, raw)
}

/**
 * Opened from the device's own dashboard. The signed-in user approves; the Worker binds the device
 * to the account, and the key that came in the fragment is stored so this browser is linked at once.
 */
export function PairPage() {
  const t = useT()
  const language = useLanguage()
  const navigate = useNavigate()
  const { pairingId = '' } = useParams()
  const { account } = useAccount()
  const [captured] = useState(() => {
    captureFragmentKey('pair', () => pairingId)
    return true
  })
  const [info, setInfo] = useState<PairingInfoDto | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Approved, but the key not stored yet: trying again stores it rather than approving a second time.
  const [approved, setApproved] = useState<PairApproveResponse | null>(null)

  useEffect(() => {
    if (!account || !captured) return
    cloud.pairing(pairingId).then(setInfo, e => setError(errorMessage(e)))
  }, [account, pairingId, captured])

  if (!account) return <Navigate to={`/login?next=${encodeURIComponent(`/pair/${pairingId}`)}`} replace />

  const approve = async () => {
    setBusy(true)
    setError(null)
    try {
      const pairing = approved ?? await cloud.approvePairing(pairingId)
      setApproved(pairing)
      await adoptParkedKey('pair', pairingId, pairing.deviceId)
      navigate(devicePath(pairing.deviceName), { replace: true })
    } catch (e) {
      setError(errorMessage(e))
      setBusy(false)
    }
  }

  return (
    <CloudFrame narrow>
      {!info && !error ? <Loading text={t('pair.title')} /> : (
        <Empty appearance="page" heading="h1" state={info?.state === 'pending' ? 'lit' : 'far'} title={t('pair.title')}
          text={info?.state === 'pending' ? t('pair.question', account.email) : info?.state === 'expired' ? t('pair.expired') : info ? t('pair.alreadyApproved') : t('pair.failed')}>
          {error && <p role="alert" className="setting-alert">{error}</p>}
          {info && info.state === 'pending' && (
            <>
              <ComputerRow as="div" name={info.name} star="lit"
                line={computerLine(t, language, { online: true, lastSeenAt: null, platform: info.platform, version: info.version }, true, null)} />
              {!parkedKey('pair', pairingId) && <p className="setting-warn">{t('pair.noKey')}</p>}
              <div className="infall-acts">
                <button type="button" className="infall-button" disabled={busy} aria-busy={busy} onClick={() => void approve()}>{t('pair.approve')}</button>
                <button type="button" className="infall-button quiet" onClick={() => navigate('/')}>{t('common.cancel')}</button>
              </div>
              <p className="fine">{t('cloud.e2eNote')}</p>
            </>
          )}
        </Empty>
      )}
    </CloudFrame>
  )
}
