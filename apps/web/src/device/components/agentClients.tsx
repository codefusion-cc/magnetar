import type { AgentClientDto, AgentClientId, AgentStatusDto } from '@magnetar/protocol'
import { buttonClass } from '@codefusion-cc/ui/react'
import { Copy } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useT } from '../../lib/i18n.tsx'
import { SettingActions, SettingSection } from '../../ui/settings.tsx'
import { CopyInput } from '../../ui/fields.tsx'
import { useCopy, useToast } from '../../ui/toast.tsx'
import { useDevice } from '../DeviceContext.tsx'
import { useRun } from '../useRun.ts'

/**
 * The AI agents on this computer, each connected to Magnetar with a click or by hand. Agents found
 * here come first; the rest wait under "Other agents", with how to set them up once installed.
 */
export function AgentClients({ onAgent }: { onAgent: (agent: AgentStatusDto) => void }) {
  const t = useT()
  const run = useRun()
  const toast = useToast()
  const { connection } = useDevice()
  const [clients, setClients] = useState<AgentClientDto[] | null>(null)
  const [connecting, setConnecting] = useState<AgentClientId | null>(null)
  /** An agent that couldn't be connected: its setup by hand opens. */
  const [failed, setFailed] = useState<AgentClientId | null>(null)
  const [showOthers, setShowOthers] = useState(false)
  useEffect(() => {
    void connection.call('agent.clients').then(setClients).catch(() => setClients([]))
  }, [connection])

  const connect = async (client: AgentClientDto) => {
    setConnecting(client.id)
    setFailed(null)
    const result = await run(() => connection.call('agent.connect', { client: client.id }), 'settings.agentConnectFailed')
    setConnecting(null)
    if (!result) return setFailed(client.id)
    setClients(result.clients)
    onAgent(result.agent)
    toast(t('settings.agentConnectedToast', client.name), 'success')
  }

  if (clients === null) return <SettingSection title={t('settings.agentsTitle')}><p className="fine" role="status">{t('common.loading')}</p></SettingSection>
  const found = clients.filter(c => c.installed)
  const others = clients.filter(c => !c.installed)
  const row = (client: AgentClientDto) => (
    <AgentRow key={client.id} client={client} busy={connecting === client.id} disabled={connecting !== null} failed={failed === client.id}
      onConnect={() => void connect(client)} />
  )
  return (
    <SettingSection title={t('settings.agentsTitle')}>
      <p>{t('settings.agentsHint')}</p>
      {found.length === 0 ? <p className="fine">{t('settings.agentNoneFound')}</p> : <ul className="setting-rows">{found.map(row)}</ul>}
      {others.length > 0 && <>
        <SettingActions>
          <button type="button" className="setting-link" aria-expanded={showOthers} onClick={() => setShowOthers(s => !s)}>{t('settings.agentOthers')}</button>
        </SettingActions>
        {showOthers && <ul className="setting-rows">{others.map(row)}</ul>}
      </>}
    </SettingSection>
  )
}

function AgentRow({ client, busy, disabled, failed, onConnect }: {
  client: AgentClientDto
  busy: boolean
  disabled: boolean
  failed: boolean
  onConnect: () => void
}) {
  const t = useT()
  // Opens by itself when connecting failed, until the user closes it.
  const [manual, setManual] = useState<boolean | null>(null)
  const open = manual ?? failed
  const action = t(client.connected ? 'settings.agentReconnect' : 'settings.agentConnect')
  const panel = `agent-manual-${client.id}`
  return (
    <li className="setting-row-open">
      <div>
        <b>{client.name}</b>
        <span>{t(client.connected ? 'settings.agentConnected' : client.installed ? 'settings.agentFound' : 'settings.agentNotFound')}</span>
      </div>
      <span className="setting-row-actions">
        <button type="button" className="setting-link" aria-expanded={open} aria-controls={panel} onClick={() => setManual(!open)}>{t('settings.agentManual')}</button>
        {client.installed && (
          <button type="button" className="infall-small" disabled={disabled} aria-busy={busy} onClick={onConnect} aria-label={`${action}: ${client.name}`}>{action}</button>
        )}
      </span>
      {open && <div id={panel} className="setting-row-more"><ManualSetup client={client} /></div>}
    </li>
  )
}

function ManualSetup({ client }: { client: AgentClientDto }) {
  const t = useT()
  const copy = useCopy(t('settings.agentCopied'))
  const { manual } = client
  if (manual.kind === 'command') {
    return (
      <div className="grid w-full gap-1.5">
        <span className="fine">{t('settings.agentManualCommand')}</span>
        <CopyInput label={client.name} value={manual.text} copyLabel={t('common.copy')} onCopy={copy} small />
      </div>
    )
  }
  return (
    <div className="grid w-full gap-1.5">
      <span className="fine break-release">{t('settings.agentManualFile', manual.file)}</span>
      <div className="relative">
        <pre className="max-h-64 overflow-auto rounded-ctl bg-raised p-3 pr-12 font-mono text-[13px]"><code>{manual.text}</code></pre>
        <button type="button" className={`${buttonClass({ tone: 'ghost', size: 'icon' })} absolute right-1 top-1`} aria-label={`${t('common.copy')}: ${client.name}`}
          title={t('common.copy')} onClick={() => void copy(manual.text)}><Copy size={16} aria-hidden /></button>
      </div>
    </div>
  )
}
