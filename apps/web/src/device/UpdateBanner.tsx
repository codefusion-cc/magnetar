import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router'
import { useFormatDate, useT } from '../lib/i18n.tsx'
import { offeredVersion, latestRelease } from '../lib/releases.ts'
import { expectsAway, installTrouble } from '../lib/updateInstall.ts'
import { RELEASES_PAGE } from '../lib/updates.ts'
import { useToast } from '../ui/toast.tsx'
import { useDevice } from './DeviceContext.tsx'
import { useRun } from './useRun.ts'

/** Where the release can be downloaded: an https page only, whoever said where. */
const httpsOnly = (url: string | null | undefined) => (url?.startsWith('https://') ? url : RELEASES_PAGE)

/** The version whose notice was hidden on this dashboard: hidden until the next one. */
const dismissedKey = (keyId: string | null) => `magnetar-update-dismissed:${keyId ?? 'local'}`

function readDismissed(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

/**
 * Says when the app behind this dashboard is out of date, updates it with one click, and follows the update to its
 * end: installed, not installed (with the reason, to try again), or an app that did not come back. While the app
 * installs and restarts, the Updating screen (`AwayScreen`) takes the page instead, and while the computer is offline
 * there is nothing to update. The app checks GitHub every 6 hours itself; on the website, the Worker's view of the
 * newest release also counts, so an app whose last check failed (or that predates checking) is still caught. Later
 * hides it per version; Settings → About says the same with the changelog under it.
 */
export function UpdateBanner() {
  const t = useT()
  const toast = useToast()
  const run = useRun()
  const formatDate = useFormatDate()
  const { connection, connectionState, updates, info, deviceName, basePath, installPhase, installedVersion, installUpdate, forgetInstall } = useDevice()
  const remote = connection.kind === 'remote'
  const latest = latestRelease.useLatest(remote)
  const { pathname } = useLocation()
  const key = dismissedKey(connection.keyId)
  const [dismissed, setDismissed] = useState(() => readDismissed(key))
  const [busy, setBusy] = useState(false)
  // The app looked and can't install the update itself: the button becomes the download link.
  const [manual, setManual] = useState<string | null>(null)

  // Said once per version, however often the language or the toast function changes.
  const told = useRef<string | null>(null)
  useEffect(() => {
    if (!installedVersion || told.current === installedVersion) return
    told.current = installedVersion
    toast(t('update.installed', installedVersion), 'success')
  }, [installedVersion, toast, t])

  const running = updates?.currentVersion ?? info?.version
  const offered = offeredVersion(running, updates?.available?.version, latest?.version)
  const waiting = expectsAway(installPhase)
  const trouble = installTrouble(t, installPhase, updates, remote ? deviceName : null, formatDate)
  // An update being followed is shown whatever was hidden, and after a reload before the app has said anything.
  const following = waiting || trouble !== null
  if (pathname.startsWith(`${basePath}/settings/about`) && updates) return null
  if (!following && (!running || !offered || dismissed === offered)) return null
  if (waiting || (!trouble && connectionState.status === 'device-offline')) return null
  const text = trouble
    ?? (remote ? t('update.bannerRemote', deviceName, running ?? '', offered ?? '') : t('update.bannerLocal', offered ?? '', running ?? ''))
  const releaseUrl = httpsOnly(updates?.available?.releaseUrl ?? latest?.pageUrl)
  // The app said it can't install itself (a copy outside Applications, Linux without a key): download instead.
  const download = manual ?? (updates?.available && !updates.canSelfInstall ? releaseUrl : null)

  const dismiss = () => {
    if (following) return forgetInstall()
    if (!offered) return
    setDismissed(offered)
    try {
      localStorage.setItem(key, offered)
    } catch {
      // Hidden for this visit only.
    }
  }
  const update = async () => {
    if (connection.state.status !== 'open') return toast(connection.state.status === 'device-offline' ? t('remote.offlineTitle', deviceName) : t('connection.reconnecting'), 'info')
    setBusy(true)
    try {
      // The website heard of the release before the app did: let the app look, then install what it found.
      const status = updates?.available ? updates : await run(() => connection.call('updates.check'))
      if (!status) return
      if (!status.available || !status.canSelfInstall) {
        // A new tab now would be a pop-up the browser blocks, long after the click: offer the link instead.
        setManual(status.available ? httpsOnly(status.available.releaseUrl) : releaseUrl)
        toast(t('update.manual'), 'info')
        return
      }
      await run(installUpdate)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div role="status" className={`update-bar${trouble ? ' trouble' : ''}`}>
      <p>{text}</p>
      <div className="infall-acts">
        {!following && <Link to={`${basePath}/settings/about`} className="infall-small sm">{t('update.whatsNew')}</Link>}
        {download ? (
          <a className="infall-button sm" href={download} target="_blank" rel="noreferrer noopener">{t('update.download')}</a>
        ) : (
          <button type="button" className="infall-button sm" disabled={busy} aria-busy={busy || undefined} onClick={() => void update()}>
            {trouble ? t('update.retry') : t('update.now')}
          </button>
        )}
        <button type="button" className="infall-small sm" onClick={dismiss}>{t(following ? 'common.close' : 'update.later')}</button>
      </div>
    </div>
  )
}
