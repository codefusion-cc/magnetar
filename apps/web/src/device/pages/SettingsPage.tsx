import type { ThemeMode } from '@codefusion-cc/theme'
import { useTheme } from '@codefusion-cc/theme/react'
import type { AgentStatusDto, HandlerStatus, LoginStartupStatus, SettingsDto, UpdateStatusDto } from '@magnetar/protocol'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router'
import { askingWhere } from '../../lib/downloadFlow.ts'
import { downloadDay } from '../../lib/downloadPresentation.ts'
import { featuresUrl } from '../../lib/featuresLink.ts'
import { LANGUAGES, useFormatDate, useLanguage, useT } from '../../lib/i18n.tsx'
import { askNotificationPermission } from '../../lib/notifications.ts'
import { Select } from '../../ui/Select.tsx'
import { Segmented } from '../../ui/controls.tsx'
import { blurOnEnter } from '../../ui/fields.tsx'
import { ConfirmDialog } from '../../ui/Modal.tsx'
import { Check, SettingActions, SettingSection, SettingValue } from '../../ui/settings.tsx'
import { Star } from '../../ui/Star.tsx'
import { theme } from '../../ui/theme.ts'
import { useCopy, useToast } from '../../ui/toast.tsx'
import { useDevice } from '../DeviceContext.tsx'
import { usePathChoice } from '../../lib/urlState.ts'
import { BrowserPushChannel } from '../components/browserPush.tsx'
import { FolderField } from '../components/folders.tsx'
import { useLegacyImport } from '../components/legacyImport.tsx'
import { RemoteAccessSection } from '../components/remoteAccess.tsx'
import { NetworkSetting, SeedingSetting, SlowerLimits, SpeedLimits } from '../components/transferSettings.tsx'
import { AgentClients } from '../components/agentClients.tsx'
import { notSavedText, SettingCheck, SettingsSaveProvider, TextSetting, useChosen, useSaveFailure, useSaveSetting } from '../settingsSave.tsx'
import { useRun } from '../useRun.ts'
import { Loading } from '../../ui/Loading.tsx'
import { CommitLink } from '@codefusion-cc/app-update/react'
import { MAGNETAR_REPO } from '@magnetar/protocol/cloud'
import { Changelog } from '../../ui/Changelog.tsx'
import { releasesProblemText } from '../../lib/releases.ts'
import { expectsAway, installTrouble } from '../../lib/updateInstall.ts'
import { cloud } from '../../lib/cloudApi.ts'

const sameList = (a: string[], b: string[]) => a.join('\n') === b.join('\n')

const SECTIONS = ['general', 'downloads', 'notifications', 'sources', 'remote', 'agents', 'about'] as const
type SectionId = (typeof SECTIONS)[number]

export function SettingsPage() {
  const t = useT()
  const { settings, basePath } = useDevice()
  // Each section has its own address: /settings is General, /settings/agents the AI agents.
  const { value: shown, redirect } = usePathChoice(useParams().section, [...SECTIONS], 'section')
  const href = (id: SectionId) => `${basePath}/settings${id === 'general' ? '' : `/${id}`}`
  if (redirect) return <Navigate to={href(redirect)} replace />
  if (!settings) return <Loading />

  return (
    <SettingsSaveProvider>
      <header className="downloads-heading"><h1>{t('settings.title')}</h1></header>
      <div className="settings-layout">
        <nav aria-label={t('settings.sections')} className="settings-sections">
          {SECTIONS.map(id => (
            <Link key={id} to={href(id)} replace aria-current={shown === id ? 'page' : undefined}>{t(`settings.section.${id}`)}</Link>
          ))}
        </nav>
        <div className="settings-panel">
          {shown === 'general' && <GeneralSection settings={settings} />}
          {shown === 'downloads' && <DownloadsSection settings={settings} />}
          {shown === 'notifications' && <NotificationsSection settings={settings} />}
          {shown === 'sources' && <SourcesSection settings={settings} />}
          {shown === 'remote' && <RemoteAccessSection />}
          {shown === 'agents' && <AgentSection />}
          {shown === 'about' && <><AboutSection /><ImportSection /></>}
          <p className="fine settings-saves">{t('settings.subtitle')}</p>
        </div>
      </div>
    </SettingsSaveProvider>
  )
}

function GeneralSection({ settings }: { settings: SettingsDto }) {
  const t = useT()
  const save = useSaveSetting()
  const { connection, deviceName } = useDevice()
  const { mode } = useTheme(theme)
  const [language, chooseLanguage] = useChosen(settings.language, language => save({ language }))
  const languageId = useId()
  const [startup, setStartup] = useState<LoginStartupStatus | null>(null)
  const [changing, setChanging] = useState(false)
  const [startupFailure, setStartupFailure] = useState<string | null>(null)
  const languageFailure = useSaveFailure('language')
  const reportsFailure = useSaveFailure('errorReportsEnabled')
  const refreshStartup = useCallback(() => void connection.call('startup.status').then(r => setStartup(r.status)).catch(() => setStartup('unavailable')), [connection])
  useEffect(refreshStartup, [refreshStartup])

  const changeStartup = async (enabled: boolean) => {
    setChanging(true)
    setStartupFailure(null)
    try {
      setStartup((await connection.call('startup.set', { enabled })).status)
    } catch (error) {
      setStartupFailure(notSavedText(t, deviceName, error))
    } finally {
      setChanging(false)
    }
  }
  const startupOn = startup === 'enabled' || startup === 'requiresApproval'

  return (
    <>
      <SettingSection title={t('settings.appearance')} hint={t('settings.appearanceHint')}>
        <Segmented appearance="quiet" label={t('settings.appearance')} value={mode} onChange={(m: ThemeMode) => theme.setMode(m)}
          options={(['system', 'light', 'dark'] as const).map(m => ({ value: m, label: t(`settings.theme.${m}`) }))} />
      </SettingSection>
      <SettingSection title={t('settings.language')} htmlFor={languageId} alert={languageFailure}>
        <Select id={languageId} value={language} onChange={chooseLanguage}
          options={LANGUAGES.map(l => ({ value: l.code, label: l.name, lang: l.code }))} />
      </SettingSection>
      <SettingSection title={t('settings.startupTitle')} alert={startupFailure ?? undefined}>
        <Check label={t('settings.startWithMac')} checked={startupOn} disabled={changing || startup === 'unavailable' || startup === null}
          onChange={enabled => void changeStartup(enabled)}
          hint={t(startup === 'unavailable' ? 'settings.startupUnavailable' : 'settings.startupHint')} />
        {startup === 'requiresApproval' && <>
          <p className="setting-warn">{t('settings.startupApproval')}</p>
          <SettingActions><button type="button" className="infall-button quiet sm" disabled={changing} onClick={refreshStartup}>{t('settings.startupRefresh')}</button></SettingActions>
        </>}
      </SettingSection>
      {connection.kind === 'local' && <HandlerSetting />}
      <SettingSection title={t('settings.errorReportsTitle')} alert={reportsFailure}>
        <SettingCheck label={t('settings.errorReports')} checked={settings.errorReportsEnabled} hint={t('settings.errorReportsHint')}
          onSave={errorReportsEnabled => save({ errorReportsEnabled })} />
      </SettingSection>
    </>
  )
}

/** Whether clicking a magnet link or opening a .torrent file comes here, and making it so. */
function HandlerSetting() {
  const t = useT()
  const run = useRun()
  const { connection } = useDevice()
  const [status, setStatus] = useState<HandlerStatus | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    void connection.call('handlers.status').then(r => setStatus(r.status)).catch(() => setStatus('unavailable'))
  }, [connection])
  const register = async () => {
    setBusy(true)
    const result = await run(() => connection.call('handlers.register'), 'settings.handlersFailed')
    if (result) setStatus(result.status)
    setBusy(false)
  }
  if (status === null) return null
  return (
    <SettingSection title={t('settings.handlers')}
      hint={status === 'default' ? t('settings.handlersOn') : status === 'unavailable' ? t('settings.handlersUnavailable') : undefined}>
      {status === 'default' && <p>{t('settings.handlersDefault')}</p>}
      {status === 'notDefault' && <>
        <p>{t('settings.handlersHint')}</p>
        <SettingActions><button type="button" className="infall-button quiet sm" disabled={busy} onClick={() => void register()}>{t('settings.handlersMake')}</button></SettingActions>
      </>}
    </SettingSection>
  )
}

function DownloadsSection({ settings }: { settings: SettingsDto }) {
  const t = useT()
  const save = useSaveSetting()
  const folderFailure = useSaveFailure('downloadFolder', 'askDownloadFolder')
  return (
    <>
      <SettingSection title={t('settings.downloadFolder')} alert={folderFailure}>
        <FolderField asPath label={t('settings.downloadFolder')} value={settings.downloadFolder}
          onChange={downloadFolder => { if (downloadFolder.trim()) void save({ downloadFolder }) }} />
        {askingWhere(settings).canRemember && (
          <SettingCheck label={t('settings.askDownloadFolder')} checked={settings.askDownloadFolder}
            onSave={askDownloadFolder => save({ askDownloadFolder })} />
        )}
      </SettingSection>
      <SeedingSetting settings={settings} />
      <SpeedLimits settings={settings} />
      <SlowerLimits settings={settings} />
      <NetworkSetting settings={settings} />
    </>
  )
}

/** A password or token: never shown, only replaced or cleared. */
function SecretSetting({ label, isSet, onSave }: { label: string; isSet: boolean; onSave: (value: string) => Promise<boolean> }) {
  const t = useT()
  const id = useId()
  const [draft, setDraft] = useState('')
  const commit = async () => {
    if (!draft) return
    const value = draft
    setDraft('')
    await onSave(value)
  }
  return (
    <div className="setting-field">
      <label htmlFor={id}>{label}</label>
      <input id={id} type="password" autoComplete="new-password" value={draft} placeholder={isSet ? t('settings.secretSaved') : ''}
        onChange={e => setDraft(e.target.value)} onBlur={() => void commit()} onKeyDown={blurOnEnter} />
      {isSet && <button type="button" className="setting-link" onClick={() => void onSave('')} aria-label={`${t('settings.secretClear')}: ${label}`}>{t('settings.secretClear')}</button>}
    </div>
  )
}

function NotificationsSection({ settings: s }: { settings: SettingsDto }) {
  const t = useT()
  const save = useSaveSetting()
  const toast = useToast()
  const run = useRun()
  const { connection } = useDevice()
  const [testing, setTesting] = useState(false)
  const [permission, setPermission] = useState(() => ('Notification' in window ? Notification.permission : 'denied'))
  const test = async () => {
    setTesting(true)
    const ok = await run(async () => { await connection.call('notifications.test'); return true }, 'settings.testFailed')
    setTesting(false)
    if (ok) toast(t('settings.testSent'), 'success')
  }
  const allow = () => {
    askNotificationPermission()
    // The prompt resolves on its own; read the answer once it has.
    setTimeout(() => setPermission(Notification.permission), 1500)
  }
  const [browserPush, setBrowserPush] = useState(false)
  const anyOn = s.desktopEnabled || s.emailEnabled || s.telegramEnabled || browserPush
  const emailFailure = useSaveFailure('emailEnabled', 'smtpHost', 'smtpPort', 'smtpUseSsl', 'smtpUsername', 'smtpPassword', 'emailFrom', 'emailTo')
  const telegramFailure = useSaveFailure('telegramEnabled', 'telegramBotToken', 'telegramChatId')
  const whatFailure = useSaveFailure('notifyOnStart', 'notifyOnComplete')
  const desktopFailure = useSaveFailure('desktopEnabled')

  return (
    <>
      <SettingSection title={t('settings.notifyTitle')} alert={whatFailure}>
        <SettingCheck label={t('settings.notifyStart')} checked={s.notifyOnStart} onSave={notifyOnStart => save({ notifyOnStart })} />
        <SettingCheck label={t('settings.notifyFinish')} checked={s.notifyOnComplete} onSave={notifyOnComplete => save({ notifyOnComplete })} />
      </SettingSection>
      {connection.kind === 'remote' && <BrowserPushChannel onChange={setBrowserPush} />}
      <SettingSection title={t('settings.desktop')} alert={desktopFailure}
        hint={s.desktopEnabled && permission === 'denied' ? t('settings.notificationsBlocked') : undefined}>
        <p>{t('settings.desktopHint')}</p>
        <SettingCheck label={t('settings.useDesktop')} checked={s.desktopEnabled}
          onSave={desktopEnabled => { if (desktopEnabled) askNotificationPermission(); return save({ desktopEnabled }) }} />
        {s.desktopEnabled && permission === 'default' && (
          <SettingActions><button type="button" className="infall-button quiet sm" onClick={allow}>{t('settings.allowNotifications')}</button></SettingActions>
        )}
      </SettingSection>
      <SettingSection title={t('settings.email')} alert={emailFailure}>
        <SettingCheck label={t('settings.useEmail')} checked={s.emailEnabled} onSave={emailEnabled => save({ emailEnabled })} />
        {s.emailEnabled && <>
          <div className="setting-two">
            <TextSetting label={t('settings.smtpHost')} value={s.smtpHost} onSave={smtpHost => save({ smtpHost: smtpHost.trim() })} />
            <TextSetting label={t('settings.port')} className="setting-short" inputMode="numeric" value={String(s.smtpPort)}
              onSave={v => { const port = Number(v); return port >= 1 && port <= 65535 ? save({ smtpPort: port }) : Promise.resolve(false) }} />
          </div>
          <SettingCheck label={t('settings.ssl')} checked={s.smtpUseSsl} onSave={smtpUseSsl => save({ smtpUseSsl })} />
          <div className="setting-two">
            <TextSetting label={t('settings.username')} autoComplete="off" value={s.smtpUsername} onSave={smtpUsername => save({ smtpUsername })} />
            <SecretSetting label={t('settings.password')} isSet={s.smtpPasswordSet} onSave={smtpPassword => save({ smtpPassword })} />
          </div>
          <div className="setting-two">
            <TextSetting type="email" label={t('settings.from')} value={s.emailFrom} onSave={emailFrom => save({ emailFrom: emailFrom.trim() })} />
            <TextSetting type="email" label={t('settings.to')} value={s.emailTo} onSave={emailTo => save({ emailTo: emailTo.trim() })} />
          </div>
        </>}
      </SettingSection>
      <SettingSection title={t('settings.telegram')} alert={telegramFailure} hint={s.telegramEnabled ? t('settings.botTokenHint') : undefined}>
        <SettingCheck label={t('settings.useTelegram')} checked={s.telegramEnabled} onSave={telegramEnabled => save({ telegramEnabled })} />
        {s.telegramEnabled && <>
          <SecretSetting label={t('settings.botToken')} isSet={s.telegramBotTokenSet} onSave={telegramBotToken => save({ telegramBotToken })} />
          <TextSetting label={t('settings.chatId')} inputMode="numeric" value={s.telegramChatId} onSave={telegramChatId => save({ telegramChatId: telegramChatId.trim() })} />
        </>}
      </SettingSection>
      <SettingSection>
        <SettingActions>
          <button type="button" className="infall-button sm" disabled={testing || !anyOn} onClick={() => void test()}>{t('settings.sendTest')}</button>
        </SettingActions>
      </SettingSection>
    </>
  )
}

function SourcesSection({ settings }: { settings: SettingsDto }) {
  const t = useT()
  const save = useSaveSetting()
  const { sources } = useDevice()
  // Each change starts from the last one chosen, so two quick changes are both kept.
  const [disabled, choose] = useChosen(settings.disabledProviders, disabledProviders => save({ disabledProviders }), sameList)
  const failure = useSaveFailure('disabledProviders')
  const off = new Set(disabled.map(p => p.toLowerCase()))
  const toggle = (name: string, on: boolean) => {
    const next = new Set(off)
    if (on) next.delete(name.toLowerCase())
    else next.add(name.toLowerCase())
    choose(sources.map(s => s.name).filter(n => next.has(n.toLowerCase())))
  }
  return (
    <SettingSection title={t('settings.sourcesTitle')} hint={t('settings.sourcesHint')} alert={failure}>
      <ul className="setting-list">
        {sources.map(s => {
          const on = !off.has(s.name.toLowerCase())
          return <li key={s.name}><Check label={<><Star state={on ? 'lit' : 'out'} />{s.name}</>} checked={on} onChange={v => toggle(s.name, v)} /></li>
        })}
      </ul>
    </SettingSection>
  )
}

function AgentSection() {
  const t = useT()
  const toast = useToast()
  const run = useRun()
  const { connection } = useDevice()
  const copy = useCopy(t('settings.agentCopied'))
  // Undefined while asking; null when the app is from before agents and cannot say.
  const [agent, setAgent] = useState<AgentStatusDto | null | undefined>(undefined)
  const [reveal, setReveal] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const tokenId = useId()
  useEffect(() => {
    void connection.call('agent.status').then(setAgent).catch(() => setAgent(null))
  }, [connection])
  const change = useCallback(async (patch: { enabled?: boolean; allowRemote?: boolean }) => {
    const next = await run(() => connection.call('agent.set', patch), 'settings.saveFailed')
    if (next) setAgent(next)
    if (next && patch.allowRemote !== undefined) toast(t('settings.agentRestart'), 'info')
    return next !== undefined
  }, [connection, run, toast, t])
  if (agent === undefined) return <Loading />
  if (agent === null) return null

  return (
    <>
      {/* Agents run on the computer itself; a remote dashboard can't set them up. */}
      {connection.kind === 'local' && <AgentClients onAgent={setAgent} />}
      <SettingSection title={t('settings.agentAddress')} hint={agent.enabled ? t('settings.agentLoopbackHint') : t('settings.agentHint')}>
        <SettingCheck label={t('settings.agentAccess')} checked={agent.enabled} onSave={enabled => change({ enabled })} />
        {agent.enabled && <>
          <SettingValue>{agent.mcpUrl}</SettingValue>
          <SettingActions><button type="button" className="infall-button quiet sm" aria-label={`${t('common.copy')}: ${t('settings.agentMcpUrl')}`} onClick={() => void copy(agent.mcpUrl)}>{t('common.copy')}</button></SettingActions>
        </>}
      </SettingSection>
      {agent.enabled && (
        <SettingSection title={t('settings.agentOtherDevices')}>
          <SettingCheck label={t('settings.agentRemote')} checked={agent.allowRemote} hint={t('settings.agentRemoteHint')} onSave={allowRemote => change({ allowRemote })} />
          {agent.allowRemote && <>
            <div className="setting-field">
              <label htmlFor={tokenId}>{t('settings.agentToken')}</label>
              <input id={tokenId} readOnly className="setting-mono" type={reveal ? 'text' : 'password'} value={agent.token} />
            </div>
            <SettingActions>
              <button type="button" className="infall-button quiet sm" aria-pressed={reveal} onClick={() => setReveal(r => !r)}>{t(reveal ? 'settings.agentHide' : 'settings.agentShow')}</button>
              <button type="button" className="infall-button quiet sm" onClick={() => void copy(agent.token)}>{t('settings.agentCopy')}</button>
              <button type="button" className="infall-button quiet sm danger" onClick={() => setConfirming(true)}>{t('settings.agentRegenerate')}</button>
            </SettingActions>
            <p className="fine break-release">{t('settings.agentEndpointFile', agent.endpointFile)}</p>
          </>}
        </SettingSection>
      )}
      <ConfirmDialog open={confirming} title={t('settings.agentRegenerateConfirmTitle')} message={t('settings.agentRegenerateConfirm')}
        options={[{ label: t('common.cancel'), value: false, tone: 'ghost' }, { label: t('settings.agentRegenerate'), value: true, tone: 'error' }]}
        onResult={async confirmed => {
          setConfirming(false)
          if (!confirmed) return
          const next = await run(() => connection.call('agent.regenerateToken'))
          if (next) {
            setAgent(next)
            toast(t('settings.agentRegenerated'), 'success')
          }
        }} />
    </>
  )
}

function ImportSection() {
  const t = useT()
  const { status, busy, runImport } = useLegacyImport()
  if (!status?.available) return null
  return (
    <SettingSection title={t('import.title')} hint={status.imported ? t('import.alreadyImported') : undefined}>
      <p>{t('import.hint', status.downloads, status.seriesTasks)}</p>
      <SettingActions><button type="button" className="infall-button quiet sm" disabled={busy} onClick={() => void runImport()}>{t('import.button')}</button></SettingActions>
    </SettingSection>
  )
}

function AboutSection() {
  const t = useT()
  const toast = useToast()
  const run = useRun()
  const formatDate = useFormatDate()
  const language = useLanguage()
  const { connection, updates, info, installPhase, installUpdate, deviceName } = useDevice()
  const [changelog, setChangelog] = useState(false)
  const changelogRef = useRef<HTMLElement>(null)
  // Through the website its own cached list, which an app from before the changelog can't answer either.
  const loadReleases = useCallback(() => (connection.kind === 'remote' ? cloud.releases() : connection.call('updates.releases')), [connection])
  useEffect(() => { if (changelog) changelogRef.current?.scrollIntoView({ block: 'nearest' }) }, [changelog])
  if (!updates) return <Loading />

  const problemText = (status: UpdateStatusDto) => status.lastCheckProblem
    ? releasesProblemText(t, status.lastCheckProblem, status.retryAt, formatDate, status.lastCheckError)
    // An app from before problems had names says only what went wrong.
    : status.lastCheckError ? t('settings.lastCheckFailed', status.lastCheckError) : null
  const waiting = expectsAway(installPhase)
  const problem = installTrouble(t, installPhase, updates, connection.kind === 'remote' ? deviceName : null, formatDate) ?? problemText(updates)
  const check = async () => {
    const status = await run(() => connection.call('updates.check'))
    if (!status) return
    const failed = problemText(status)
    if (status.available) toast(t('settings.updateSnack', status.available.version), 'info')
    else if (failed) toast(failed, 'error')
    else toast(t('settings.upToDate', status.currentVersion), 'success')
  }
  const statusText = updates.checking ? t('settings.checking')
    : problem ?? (updates.available ? t('settings.updateAvailable', updates.available.version)
    : updates.lastCheckedAt ? t('settings.checkedAt', downloadDay(language, updates.lastCheckedAt, true))
    : t('settings.upToDateUnchecked'))

  return (
    <>
      <SettingSection title={t('settings.versionTitle', updates.currentVersion)}
        hint={<>{t('settings.checkAuto')}{updates.currentCommit && <> {t('settings.commit')} <CommitLink commit={updates.currentCommit} repo={MAGNETAR_REPO} className="setting-link" />.</>}</>}>
        <p className={problem ? 'setting-warn' : ''}>{statusText}</p>
        <SettingActions>
          {updates.available && (updates.canSelfInstall ? (
            <button type="button" className="infall-button sm" disabled={waiting || installPhase === 'lost'} onClick={() => void run(installUpdate)}>
              {waiting ? t('settings.installing') : t('settings.install', updates.available.version)}
            </button>
          ) : (
            <a className="infall-button sm" href={updates.available.releaseUrl} target="_blank" rel="noreferrer noopener">{t('settings.openRelease')}</a>
          ))}
          <button type="button" className="infall-button quiet sm" disabled={updates.checking} onClick={() => void check()}>{t('settings.checkUpdates')}</button>
          <button type="button" className="setting-link" aria-expanded={changelog} onClick={() => setChangelog(c => !c)}>{t('changelog.title')}</button>
        </SettingActions>
      </SettingSection>
      {changelog && (
        <section ref={changelogRef} className="setting" aria-label={t('changelog.title')}>
          <Changelog load={loadReleases} running={updates.currentVersion} />
        </section>
      )}
      <SettingSection title={t('settings.features')}>
        <SettingActions><a className="infall-button quiet sm" href={featuresUrl(language)} target="_blank" rel="noreferrer noopener">{t('settings.openFeatures')}</a></SettingActions>
      </SettingSection>
      {info && (
        <SettingSection title={t('settings.dataFolder')} hint={`${info.platform}, ${info.arch}`}>
          <SettingValue>{info.dataDirectory}</SettingValue>
        </SettingSection>
      )}
    </>
  )
}
