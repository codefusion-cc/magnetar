import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { useT } from '../lib/i18n.tsx'
import { expectsAway } from '../lib/updateInstall.ts'
import { Empty } from '../ui/Empty.tsx'
import { useDevice } from './DeviceContext.tsx'

/** Why the page gives way to a screen of its own: the app restarting to update, or a computer the relay says is offline. */
export type Away = 'updating' | 'offline'

/** How long the relay must say the computer is offline before the page gives way: a quick reconnect shows nothing. */
const OFFLINE_AFTER_MS = 400

/**
 * Whether the computer is away, and why. Offline holds while the page reconnects after it, so the page does not flash
 * back for the moment between the relay's word that the computer is back and the end of the handshake.
 */
export function useAway(): Away | null {
  const { connectionState, installPhase } = useDevice()
  const status = connectionState.status
  const [offline, setOffline] = useState(false)
  useEffect(() => {
    if (status === 'device-offline') {
      const timer = setTimeout(() => setOffline(true), OFFLINE_AFTER_MS)
      return () => clearTimeout(timer)
    }
    if (status !== 'connecting' && status !== 'reconnecting') setOffline(false)
  }, [status])
  if (expectsAway(installPhase)) return 'updating'
  return offline ? 'offline' : null
}

/**
 * The page while the computer is away. It takes focus when it took the place of what had it (the Update now button, a
 * row), so a screen reader says what happened; when the page comes back, focus goes back to it.
 */
export function AwayScreen({ away }: { away: Away }) {
  const t = useT()
  const { connection, deviceName, remote } = useDevice()
  const screen = useRef<HTMLElement>(null)
  const local = connection.kind === 'local'

  useEffect(() => {
    if (lostFocus()) screen.current?.focus()
    return () => {
      // The page that comes back renders in the same commit; it may still be reading its lists, so the page itself.
      requestAnimationFrame(() => { if (lostFocus()) document.querySelector<HTMLElement>('main')?.focus({ preventScroll: true }) })
    }
  }, [])

  if (away === 'updating') return (
    <Empty appearance="page" heading="h1" state="updating" role="status" ref={screen} tabIndex={-1} className="away-screen"
      title={local ? t('update.installingLocal') : t('update.installingRemote', deviceName)} text={t('update.installingText')}>
      <p className="fine">{t('update.installingNote')}</p>
    </Empty>
  )
  // The way to the account's other computers, as the device menu has it: the website's list, or from this computer's
  // own dashboard the website itself.
  const others = !local ? <Link to="/" className="infall-button quiet">{t('devices.others')}</Link>
    : remote?.paired ? <a href={remote.cloudUrl} target="_blank" rel="noopener" className="infall-button quiet">{t('devices.others')}</a>
    : null
  return (
    <Empty appearance="page" heading="h1" state="out" role="alert" ref={screen} tabIndex={-1} className="away-screen"
      title={t('remote.offlineTitle', deviceName)} text={t('remote.deviceOffline')}>
      {others && <div className="infall-acts">{others}</div>}
    </Empty>
  )
}

/** Focus fell to the document when what had it left the page. */
const lostFocus = () => !document.activeElement || document.activeElement === document.body
