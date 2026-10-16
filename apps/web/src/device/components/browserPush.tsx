import { useEffect, useState } from 'react'
import { useT } from '../../lib/i18n.tsx'
import { disablePush, enablePush, pushStatus, pushSupport, type PushSupport } from '../../lib/push.ts'
import { Check, SettingSection } from '../../ui/settings.tsx'
import { useDevice } from '../DeviceContext.tsx'
import { useRun } from '../useRun.ts'

/**
 * Notifications on this phone or browser even with the website closed. Offered on the website
 * only: the dashboard on the computer running the app has desktop notifications.
 */
export function BrowserPushChannel({ onChange }: { onChange?: (on: boolean) => void }) {
  const t = useT()
  const run = useRun()
  const { connection } = useDevice()
  const [on, setOn] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<PushSupport>(() => pushSupport())

  useEffect(() => {
    let cancelled = false
    void pushStatus(connection).then(value => !cancelled && setOn(value)).catch(() => !cancelled && setOn(false))
    return () => { cancelled = true }
  }, [connection])
  useEffect(() => { if (on !== null) onChange?.(on) }, [on, onChange])

  const toggle = async (next: boolean) => {
    setBusy(true)
    if (next) {
      const outcome = await run(() => enablePush(connection), 'push.failed')
      if (outcome) setProblem(outcome)
      setOn(outcome === 'ok')
    } else {
      await run(() => disablePush(connection), 'push.failed')
      setOn(false)
    }
    setBusy(false)
  }

  const hint = problem === 'install' ? t('push.installFirst')
    : problem === 'denied' ? t('push.blocked')
    : problem === 'server' ? t('push.noServer')
    : problem === 'unsupported' ? t('push.unsupported') : undefined

  return (
    <SettingSection title={t('push.title')} hint={hint}>
      <p>{t('push.hint')}</p>
      {on === null ? <p className="fine" role="status">{t('common.loading')}</p>
        : <Check label={t('push.use')} checked={on} disabled={busy || problem === 'unsupported' || problem === 'install'} onChange={v => void toggle(v)} />}
    </SettingSection>
  )
}
