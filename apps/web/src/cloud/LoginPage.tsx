import { useEffect, useRef, useState } from 'react'
import { Navigate, useSearchParams } from 'react-router'
import { startGoogleSignIn, takeGoogleSignInResult } from '@codefusion-cc/google-sign-in/browser'
import { safeReturnPath } from '@codefusion-cc/sign-in/browser'
import { cloud, CloudError } from '../lib/cloudApi.ts'
import { errorMessage } from '../lib/errors.ts'
import { useLanguage, useT } from '../lib/i18n.tsx'
import { useAccount } from './CloudApp.tsx'
import { CloudFrame } from './CloudFrame.tsx'
import { Empty } from '../ui/Empty.tsx'

/** What to say about a return from Google that brought no credential; a cancelled one says nothing. */
const RETURN_ERRORS = { expired: 'cloud.signInExpired', failed: 'cloud.signInFailed' } as const
/** What to say when the Worker refuses the credential: 503 when Google's keys could not be read. */
const STATUS_ERRORS: Partial<Record<number, 'cloud.signInFailed' | 'cloud.signInUnavailable'>> = { 401: 'cloud.signInFailed', 503: 'cloud.signInUnavailable' }

export function LoginPage() {
  const t = useT()
  const language = useLanguage()
  const { account, config, refresh } = useAccount()
  const [params] = useSearchParams()
  // Only a path on this site: a browser reads `/\host` or `/<tab>/host` as another site, and React Router would throw.
  const next = safeReturnPath(params.get('next'), '/')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [devEmail, setDevEmail] = useState('dev@localhost')
  const handled = useRef(false)

  // Coming back from Google: the token is in the fragment, verified by the Worker.
  useEffect(() => {
    if (handled.current) return
    handled.current = true
    const result = takeGoogleSignInResult()
    if (!result) return
    // Closing Google's account chooser is a choice, not an error to report.
    if ('error' in result) {
      if (result.error !== 'cancelled') setError(t(RETURN_ERRORS[result.error]))
      return
    }
    setBusy(true)
    cloud.completeSignIn(result.credential).then(refresh, e => {
      const key = e instanceof CloudError ? STATUS_ERRORS[e.status] : undefined
      setError(key ? t(key) : errorMessage(e))
    }).finally(() => setBusy(false))
  }, [refresh, t])

  if (account) return <Navigate to={next} replace />

  const signIn = async () => {
    setBusy(true)
    setError(null)
    try {
      const { nonce, clientId } = await cloud.startSignIn()
      // Google returns to this page, /login with its `next`; a Preview's sign-in goes through staging's callback.
      if (!startGoogleSignIn({ clientId, nonce, locale: language, callbackOrigin: config.googleCallbackOrigin })) {
        setError(t('cloud.signInFailed'))
        setBusy(false)
      }
    } catch (e) {
      setError(errorMessage(e))
      setBusy(false)
    }
  }

  const devSignIn = async () => {
    setBusy(true)
    try {
      await cloud.devSignIn(devEmail)
      await refresh()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <CloudFrame narrow>
      <Empty appearance="page" heading="h1" title={t('cloud.signInTitle')} text={t('cloud.signInLead')}>
        {error && <p role="alert" className="setting-alert">{error}</p>}
        {config.googleClientId && (
          <div className="infall-acts">
            <button type="button" className="infall-button big" disabled={busy} aria-busy={busy} onClick={() => void signIn()}>
              <GoogleLogo />{t('cloud.signInGoogle')}
            </button>
          </div>
        )}
        <p className="fine">{t('cloud.signInFine')}</p>
        {config.devLogin && (
          <form className="site-dev-login" onSubmit={e => { e.preventDefault(); void devSignIn() }}>
            <label htmlFor="dev-email">{t('cloud.devLogin')}</label>
            <div className="setting-inline">
              <input id="dev-email" aria-label="Email" value={devEmail} onChange={e => setDevEmail(e.target.value)} />
              <button type="submit" className="infall-small" disabled={busy}>{t('cloud.devSignIn')}</button>
            </div>
          </form>
        )}
      </Empty>
    </CloudFrame>
  )
}

function GoogleLogo() {
  return (
    <svg viewBox="0 0 48 48" className="google-logo" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  )
}
