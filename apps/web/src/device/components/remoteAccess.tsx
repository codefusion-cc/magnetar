import { reservedDeviceName, toDeviceName } from '@magnetar/protocol/device-name'
import QRCode from 'qrcode'
import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { useFormatRelative, useT } from '../../lib/i18n.tsx'
import { CopyInput } from '../../ui/fields.tsx'
import { SettingActions, SettingSection, SettingValue } from '../../ui/settings.tsx'
import { ConfirmDialog, Modal } from '../../ui/Modal.tsx'
import { useCopy, useToast } from '../../ui/toast.tsx'
import { useDevice } from '../DeviceContext.tsx'
import { followLink, type LinkWatch } from '../linkState.ts'
import { useRun } from '../useRun.ts'

/** The link the dialog shows, followed until a browser uses it or it stops working. */
interface ShownLink extends LinkWatch {
  /** As typed; empty when the browser was left unnamed. */
  label: string
  url: string
  qr: string
  /** What to type instead of scanning; absent when the app is from before codes. */
  code?: string
  ended?: 'expired' | 'revoked'
}

/**
 * Connecting this device to magnetar.codefusion.cc. Pairing opens the website in a new
 * tab; that browser signs in, approves, and receives its end-to-end key in the link fragment.
 * More browsers (a phone) are linked by scanning a QR code carrying a freshly minted key; the
 * dialog showing it closes by itself once that browser has connected.
 */
export function RemoteAccessSection() {
  const t = useT()
  const formatRelative = useFormatRelative('long')
  const copy = useCopy(t('info.copied'))
  const toast = useToast()
  const run = useRun()
  const { connection, remote } = useDevice()
  const [name, setName] = useState('')
  const [link, setLink] = useState<ShownLink | null>(null)
  const [minting, setMinting] = useState(false)
  // Counts the dialog's requests: closing it makes a link still on its way stale.
  const request = useRef(0)
  const [label, setLabel] = useState('')
  const [confirm, setConfirm] = useState<'unpair' | { revoke: string } | null>(null)
  // Opened from the website's Connect this computer (magnetar://connect): Connect waits under the cursor.
  const connectAsked = useSearchParams()[0].has('connect')
  useEffect(() => setName(remote?.deviceName ?? ''), [remote?.deviceName])

  const closeLink = () => {
    request.current++
    setMinting(false)
    setLink(null)
  }

  // The device lists the browsers again whenever one connects or a link expires.
  const paired = remote?.paired ?? false
  const browsers = remote?.browsers
  useEffect(() => {
    if (!link || link.ended || !browsers) return
    if (!paired) return closeLink()
    const next = followLink(link, browsers, Date.now())
    if (next.state === 'linked') {
      closeLink()
      toast(link.label ? t('remote.browserLinked', next.browser.label) : t('remote.browserLinkedUnnamed'), 'success')
    } else if (next.state !== 'waiting') {
      setLink({ ...link, listed: true, ended: next.state })
    } else if (next.listed !== link.listed) {
      setLink({ ...link, listed: true })
    }
  }, [link, browsers, paired, toast, t])

  if (!remote) return null
  const local = connection.kind === 'local'
  // The name is the device's address on the website, so it is spelled as one: shown as typed, sent as spelled.
  const spelled = name.trim() ? toDeviceName(name) : ''
  // The website this app is reached at, as people type it: magnetar.codefusion.cc, the preview one for Magnetar Preview.
  const site = remote.cloudUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')
  const address = `${site}/${spelled}`
  // A word the website keeps for its own pages: say why the address differs from the name typed.
  const reserved = reservedDeviceName(name)
  const pair = async () => {
    // Open the tab inside the click so popup blockers allow it, then point it at the link.
    const tab = window.open('about:blank', '_blank')
    const status = await run(() => connection.call('remote.pair', { deviceName: spelled || undefined }), 'remote.pairFailed')
    if (!status?.pendingPairing) return tab?.close()
    if (tab) {
      tab.opener = null
      tab.location.href = status.pendingPairing.url
    }
  }

  const mintLink = async (forLabel: string) => {
    const mine = ++request.current
    setMinting(true)
    try {
      const minted = await run(() => connection.call('remote.linkBrowser', { label: forLabel || undefined }))
      if (!minted) return
      const deadline = minted.expiresIn === undefined ? undefined : Date.now() + minted.expiresIn * 1000
      const qr = await QRCode.toDataURL(minted.url, { margin: 1, width: 280, errorCorrectionLevel: 'M' })
      // Closed while the link was on its way: nobody will see it, so it should not linger in the list.
      if (request.current !== mine) return void connection.call('remote.revokeBrowser', { keyId: minted.keyId }).catch(() => {})
      setLink({ keyId: minted.keyId, codeKeyId: minted.codeKeyId, listed: false, deadline, label: forLabel, url: minted.url, qr, code: minted.code })
      setLabel('')
    } finally {
      if (request.current === mine) setMinting(false)
    }
  }

  const linkLabelId = 'magnetar-link-label'
  const nameForm = (submit: string, onSubmit: () => void, disabled = false, focus = false) => (
    <form className="setting-inline" onSubmit={e => { e.preventDefault(); onSubmit() }}>
      <input id="magnetar-device-name" maxLength={60} autoComplete="off" spellCheck={false} value={name} onChange={e => setName(e.target.value)}
        aria-describedby={spelled ? 'magnetar-device-address' : undefined} />
      <button type="submit" className="infall-button quiet sm" disabled={disabled} autoFocus={focus}>{submit}</button>
    </form>
  )
  const nameHint = spelled && <span id="magnetar-device-address" className={reserved ? 'setting-warn' : undefined}>{reserved ? t('remote.reservedName', reserved, address) : t('remote.address', address)}</span>

  return (
    <>
      {!remote.paired ? (
        <SettingSection title={t('remote.title')} alert={remote.lastError ?? undefined}>
          <p>{t('remote.hint', site)}</p>
          {local && (remote.pendingPairing ? <>
            <p className="setting-waiting" role="status">{t('remote.waiting')}</p>
            <SettingActions>
              <a className="infall-button sm" href={remote.pendingPairing.url} target="_blank" rel="noopener noreferrer">{t('remote.openAgain')}</a>
              <button type="button" className="infall-button quiet sm" onClick={() => void run(() => connection.call('remote.cancelPairing'))}>{t('common.cancel')}</button>
            </SettingActions>
          </> : <>
            <div className="setting-field"><label htmlFor="magnetar-device-name">{t('remote.deviceName')}</label></div>
            {nameForm(t('remote.connect'), () => void pair(), false, connectAsked)}
            {nameHint && <p className="fine">{nameHint}</p>}
          </>)}
        </SettingSection>
      ) : <>
        <SettingSection title={t('remote.reachable')} alert={remote.lastError ?? undefined}
          hint={remote.connected ? undefined : t('remote.reconnecting')}>
          <p>{t('remote.reachableHint', remote.accountEmail ?? '')}</p>
          <SettingValue><a href={`${remote.cloudUrl.replace(/\/$/, '')}/${remote.deviceName}`} target="_blank" rel="noopener noreferrer">{`${site}/${remote.deviceName}`}</a></SettingValue>
        </SettingSection>
        <SettingSection title={t('remote.deviceName')} htmlFor="magnetar-device-name" hint={spelled !== remote.deviceName ? nameHint || undefined : undefined}>
          {nameForm(t('remote.rename'), () => { if (spelled && spelled !== remote.deviceName) void run(() => connection.call('remote.rename', { deviceName: spelled })) },
            !spelled || spelled === remote.deviceName)}
        </SettingSection>
        <SettingSection title={t('remote.browsers')}>
          {remote.browsers.length === 0 ? <p className="fine">{t('remote.noBrowsers')}</p> : (
            <ul className="setting-rows">
              {remote.browsers.map(b => (
                <li key={b.keyId}>
                  <div>
                    <b>{b.label}</b>
                    <span>{connection.keyId === b.keyId ? t('remote.thisBrowserNow') : b.lastSeenAt ? t('remote.lastUsed', formatRelative(b.lastSeenAt)) : t('remote.neverUsed')}</span>
                  </div>
                  <button type="button" className="infall-small danger" aria-label={`${t('remote.revoke')}: ${b.label}`} onClick={() => setConfirm({ revoke: b.keyId })}>{t('remote.revoke')}</button>
                </li>
              ))}
            </ul>
          )}
          <form className="setting-inline" onSubmit={e => { e.preventDefault(); if (!minting) void mintLink(label.trim()) }}>
            <input id={linkLabelId} aria-label={t('remote.browserLabel')} maxLength={60} value={label} placeholder={t('remote.browserLabelPlaceholder')} onChange={e => setLabel(e.target.value)} />
            <button type="submit" className="infall-button sm" disabled={minting} aria-busy={minting && !link}>{t('remote.linkBrowser')}</button>
          </form>
        </SettingSection>
        <SettingSection title={t('remote.disconnect')}>
          <p>{t('remote.disconnectHint')}</p>
          <SettingActions><button type="button" className="infall-small danger" onClick={() => setConfirm('unpair')}>{t('remote.disconnectButton')}</button></SettingActions>
        </SettingSection>
      </>}

      <Modal open={link !== null} title={t('remote.linkTitle')} onClose={closeLink}
        actions={link?.ended ? <>
          <button type="button" className="infall-button quiet" onClick={closeLink}>{t('common.close')}</button>
          {/* Focus moves here, since the link it replaces had it. */}
          <button type="button" className="infall-button" disabled={minting} aria-busy={minting} autoFocus onClick={() => void mintLink(link.label)}>{t('remote.newLink')}</button>
        </> : <button type="button" className="infall-button" onClick={closeLink}>{t('common.done')}</button>}>
        {link && (link.ended ? (
          <p role="alert" className="setting-warn">{t(link.ended === 'expired' ? 'remote.linkExpired' : 'remote.linkRevoked')}</p>
        ) : (
          <div className="flex flex-col items-center gap-3 text-center">
            <p>{t('remote.linkHint')}</p>
            <img src={link.qr} alt={t('remote.linkTitle')} className="size-64 rounded-ctl bg-white p-2" />
            {link.code && (
              <div className="flex flex-col items-center gap-1">
                <span className="fine">{t('remote.linkCode')}</span>
                <code className="select-all font-mono text-xl font-semibold tracking-wider" aria-label={t('remote.linkCode')}>{link.code}</code>
              </div>
            )}
            <CopyInput small label={t('remote.linkTitle')} value={link.url} copyLabel={t('common.copy')} onCopy={value => void copy(value)} />
            {link.deadline !== undefined && <LinkExpiry deadline={link.deadline} />}
            <p className="fine setting-warn">{t('remote.linkWarning')}</p>
          </div>
        ))}
      </Modal>

      <ConfirmDialog open={confirm !== null}
        title={confirm === 'unpair' ? t('remote.disconnectTitle') : t('remote.revokeTitle')}
        message={confirm === 'unpair' ? t('remote.disconnectConfirm') : t('remote.revokeConfirm')}
        options={[{ label: t('common.cancel'), value: false, tone: 'ghost' }, { label: confirm === 'unpair' ? t('remote.disconnectButton') : t('remote.revoke'), value: true, tone: 'error' }]}
        onResult={confirmed => {
          const action = confirm
          setConfirm(null)
          if (!confirmed || !action) return
          if (action === 'unpair') void run(() => connection.call('remote.unpair'))
          else void run(() => connection.call('remote.revokeBrowser', { keyId: action.revoke }))
        }} />
    </>
  )
}

/** How long a link has left, kept current while it is shown. */
function LinkExpiry({ deadline }: { deadline: number }) {
  const t = useT()
  const formatRelative = useFormatRelative('short', 'always')
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000)
    return () => clearInterval(timer)
  }, [])
  const seconds = (deadline - now) / 1000
  // Gone once the time is up: the device deletes the key then, and the dialog says the link expired.
  if (seconds <= 0) return null
  return <p className="fine">{t('remote.linkExpires', formatRelative(Math.max(deadline, now + 1000), now))}</p>
}
