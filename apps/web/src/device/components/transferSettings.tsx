import type { NetworkInterfaceDto, SettingsDto } from '@magnetar/protocol'
import { MIN_SPEED_LIMIT } from '@magnetar/protocol/limits'
import { useEffect, useId, useMemo, useState } from 'react'
import { formatters, useLanguage, useT } from '../../lib/i18n.tsx'
import { Segmented } from '../../ui/controls.tsx'
import { Select } from '../../ui/Select.tsx'
import { blurOnEnter } from '../../ui/fields.tsx'
import { SettingSection } from '../../ui/settings.tsx'
import { useDevice } from '../DeviceContext.tsx'
import { useChosen, useDraft, useSaveFailure, useSaveSetting } from '../settingsSave.tsx'

/** Speeds are typed in decimal megabytes a second, as the rest of the dashboard shows sizes. */
const MB = 1_000_000
const sameDays = (a: number[], b: number[]) => a.join() === b.join()

/** Seeding after a download finishes: stop, keep going, or until a ratio. */
export function SeedingSetting({ settings }: { settings: SettingsDto }) {
  const t = useT()
  const language = useLanguage()
  const save = useSaveSetting()
  const [action, choose] = useChosen(settings.postDownloadAction, postDownloadAction => save({ postDownloadAction }))
  const failure = useSaveFailure('postDownloadAction', 'seedRatio')
  const ratio = formatters(language).number(settings.seedRatio)
  const help = { StopSeeding: 'settings.stopSeedingHelp', KeepSeeding: 'settings.keepSeedingHelp', SeedToRatio: 'settings.seedRatioHelp' }[action]
  return (
    <SettingSection title={t('settings.postDownload')} hint={t(help, ratio)} alert={failure}>
      <Segmented label={t('settings.postDownload')} value={action} onChange={choose}
        options={[
          { value: 'StopSeeding', label: t('settings.stopSeeding') },
          { value: 'KeepSeeding', label: t('settings.keepSeeding') },
          { value: 'SeedToRatio', label: t('settings.seedToRatio') },
        ]} />
      {action === 'SeedToRatio' && (
        <NumberSetting label={t('settings.seedRatio')} value={settings.seedRatio} min={0.1} max={100}
          onSave={seedRatio => save({ seedRatio })} />
      )}
    </SettingSection>
  )
}

/** A number as its field shows it: at most two decimals, so a ratio of 1.555 shows as 1.56. */
export const numberText = (n: number, language: string) => formatters(language).number(n, { maximumFractionDigits: 2, useGrouping: false })
const typedNumber = (draft: string) => Number(draft.trim().replace(',', '.'))

/** The number to save once the field is left, or null: unchanged, or still showing the value as it was rounded. */
export function numberToSave(draft: string, value: number, language: string): number | null {
  const parsed = typedNumber(draft)
  return draft === numberText(value, language) || parsed === value ? null : parsed
}

/** A speed cap in MB/s as its field shows it, to three decimals; blank is no cap. */
export const speedText = (bytes: number, language: string) => (bytes ? formatters(language).number(bytes / MB, { maximumFractionDigits: 3, useGrouping: false }) : '')
/** Bytes a second from what is typed in MB/s; NaN when it is not a number. */
export function typedSpeed(draft: string): number {
  const text = draft.trim().replace(',', '.')
  return text === '' ? 0 : Math.round(Number(text) * MB)
}

/** The cap to save once the field is left, or null: unchanged, or still showing the cap as it was rounded. */
export function speedToSave(draft: string, value: number, language: string): number | null {
  const bytes = typedSpeed(draft)
  return draft === speedText(value, language) || bytes === value ? null : bytes
}

/** A number typed in the dashboard's language (1,5 in Polish); out of range or not a number goes back to the value. */
function NumberSetting({ label, value, min, max, onSave }: {
  label: string
  value: number
  min: number
  max: number
  onSave: (value: number) => Promise<boolean>
}) {
  const id = useId()
  const language = useLanguage()
  const [draft, setDraft, focus, reset] = useDraft(numberText(value, language))
  const parsed = typedNumber(draft)
  const valid = draft.trim() !== '' && Number.isFinite(parsed) && parsed >= min && parsed <= max
  const commit = async () => {
    focus.onBlur()
    if (!valid) return reset()
    const next = numberToSave(draft, value, language)
    if (next !== null && !(await onSave(next))) reset()
  }
  return (
    <div className="setting-field setting-short">
      <label htmlFor={id}>{label}</label>
      <input id={id} inputMode="decimal" aria-invalid={!valid} value={draft} onChange={e => setDraft(e.target.value)}
        onFocus={focus.onFocus} onBlur={() => void commit()} onKeyDown={blurOnEnter} />
    </div>
  )
}

/** A speed cap in bytes a second, typed in MB/s. Blank or 0 is no cap; anything else is at least what the engine takes. */
function SpeedSetting({ label, value, onSave }: { label: string; value: number; onSave: (value: number) => Promise<boolean> }) {
  const t = useT()
  const id = useId()
  const language = useLanguage()
  const [draft, setDraft, focus, reset] = useDraft(speedText(value, language))
  const bytes = typedSpeed(draft)
  const error = !Number.isFinite(bytes) || bytes < 0 ? t('settings.speedInvalid')
    : bytes !== 0 && bytes < MIN_SPEED_LIMIT ? t('settings.speedTooLow', formatters(language).number(Math.ceil(MIN_SPEED_LIMIT / 1000))) : null
  const commit = async () => {
    focus.onBlur()
    const next = error ? null : speedToSave(draft, value, language)
    if (next !== null && !(await onSave(next))) reset()
  }
  return (
    <div className="setting-field">
      <label htmlFor={id}>{label}</label>
      <input id={id} inputMode="decimal" placeholder={t('settings.noLimit')} aria-invalid={error !== null} aria-describedby={error ? `${id}-error` : undefined}
        value={draft} onChange={e => setDraft(e.target.value)} onFocus={focus.onFocus} onBlur={() => void commit()} onKeyDown={blurOnEnter} />
      {error && <span id={`${id}-error`} className="setting-field-error">{error}</span>}
    </div>
  )
}

const toTime = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
const fromTime = (text: string) => {
  const [h, m] = text.split(':').map(Number)
  return h === undefined || m === undefined || Number.isNaN(h) || Number.isNaN(m) ? null : h * 60 + m
}

/** The usual caps for all downloads together. */
export function SpeedLimits({ settings }: { settings: SettingsDto }) {
  const t = useT()
  const save = useSaveSetting()
  const failure = useSaveFailure('downloadLimit', 'uploadLimit')
  return (
    <SettingSection title={t('settings.speedTitle')} hint={t('settings.speedHint')} alert={failure}>
      <div className="setting-two">
        <SpeedSetting label={t('settings.speedDownload')} value={settings.downloadLimit} onSave={downloadLimit => save({ downloadLimit })} />
        <SpeedSetting label={t('settings.speedUpload')} value={settings.uploadLimit} onSave={uploadLimit => save({ uploadLimit })} />
      </div>
    </SettingSection>
  )
}

/** Slower caps, and when they apply: never, on a schedule, or always (also switched from the Downloads page). */
export function SlowerLimits({ settings }: { settings: SettingsDto }) {
  const t = useT()
  const language = useLanguage()
  const save = useSaveSetting()
  const [mode, chooseMode] = useChosen(settings.altSpeedMode, altSpeedMode => save({ altSpeedMode }))
  const [days, chooseDays] = useChosen(settings.altScheduleDays, altScheduleDays => save({ altScheduleDays }), sameDays)
  // Monday first, named in the dashboard's language (1 Jan 2024 was a Monday).
  const names = useMemo(() => Array.from({ length: 7 }, (_, i) =>
    new Date(Date.UTC(2024, 0, 1 + i)).toLocaleDateString(language, { weekday: 'short', timeZone: 'UTC' })), [language])
  const fromId = useId(), toId = useId()
  const failure = useSaveFailure('altSpeedMode', 'altDownloadLimit', 'altUploadLimit', 'altScheduleFrom', 'altScheduleTo', 'altScheduleDays')
  const toggleDay = (day: number) => chooseDays((days.includes(day) ? days.filter(d => d !== day) : [...days, day]).sort())
  const hint = mode !== 'scheduled' ? undefined
    : settings.altScheduleFrom > settings.altScheduleTo ? t('settings.altOvernight')
    : settings.altScheduleFrom === settings.altScheduleTo ? t('settings.altAllDay') : t('settings.altWindow')
  return (
    <SettingSection title={t('settings.altLimits')} hint={hint} alert={failure}>
      <Segmented label={t('settings.altWhen')} value={mode} onChange={chooseMode}
        options={[
          { value: 'off', label: t('settings.altOff') },
          { value: 'scheduled', label: t('settings.altScheduled') },
          { value: 'on', label: t('settings.altAlways') },
        ]} />
      {mode !== 'off' && (
        <div className="setting-two">
          <SpeedSetting label={t('settings.speedDownload')} value={settings.altDownloadLimit} onSave={altDownloadLimit => save({ altDownloadLimit })} />
          <SpeedSetting label={t('settings.speedUpload')} value={settings.altUploadLimit} onSave={altUploadLimit => save({ altUploadLimit })} />
        </div>
      )}
      {mode === 'scheduled' && <>
        <div className="setting-two">
          <div className="setting-field">
            <label htmlFor={fromId}>{t('settings.altFrom')}</label>
            <input id={fromId} type="time" value={toTime(settings.altScheduleFrom)}
              onChange={e => { const m = fromTime(e.target.value); if (m !== null && m !== settings.altScheduleFrom) void save({ altScheduleFrom: m }) }} />
          </div>
          <div className="setting-field">
            <label htmlFor={toId}>{t('settings.altTo')}</label>
            <input id={toId} type="time" value={toTime(settings.altScheduleTo)}
              onChange={e => { const m = fromTime(e.target.value); if (m !== null && m !== settings.altScheduleTo) void save({ altScheduleTo: m }) }} />
          </div>
        </div>
        <div role="group" aria-label={t('settings.altDays')} className="setting-days">
          {names.map((name, day) => (
            <button key={day} type="button" aria-pressed={days.includes(day)} onClick={() => toggleDay(day)}>{name}</button>
          ))}
        </div>
      </>}
    </SettingSection>
  )
}

/** Torrent traffic only through one network connection (a VPN), and none without it. */
export function NetworkSetting({ settings }: { settings: SettingsDto }) {
  const t = useT()
  const save = useSaveSetting()
  const { connection, transfer } = useDevice()
  const id = useId()
  const [list, setList] = useState<{ supported: boolean; interfaces: NetworkInterfaceDto[] } | null>(null)
  const refresh = () => void connection.call('network.interfaces').then(setList).catch(() => setList({ supported: false, interfaces: [] }))
  useEffect(refresh, [connection])
  const [chosen, choose] = useChosen(settings.networkInterface, networkInterface => save({ networkInterface }))
  const failure = useSaveFailure('networkInterface')
  if (!list) return null
  if (!list.supported) return <SettingSection title={t('settings.networkTitle')} hint={t('settings.networkUnsupported')} />
  const missing = chosen !== '' && !list.interfaces.some(i => i.name === chosen)
  const waiting = transfer?.engine === 'waitingForNetwork'
  return (
    <SettingSection title={t('settings.networkTitle')} htmlFor={id} alert={failure ?? (waiting || missing ? t('settings.networkMissing', chosen) : undefined)}
      hint={chosen ? (missing ? undefined : t('settings.networkBound', chosen)) : t('settings.networkAny')}>
      <Select id={id} value={chosen} onOpen={refresh} onChange={choose} options={[
        { value: '', label: t('settings.networkAnyOption') },
        ...(missing ? [{ value: chosen, label: t('settings.networkMissingOption', chosen) }] : []),
        ...list.interfaces.map(i => ({ value: i.name, label: i.vpn ? `${i.name} (VPN)` : i.name })),
      ]} />
    </SettingSection>
  )
}
