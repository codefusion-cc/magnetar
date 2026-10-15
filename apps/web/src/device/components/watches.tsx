import type { WatchDto, WatchInput } from '@magnetar/protocol'
import { BellRing, RotateCcw, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { useFormatBytes, useFormatRelative, useT } from '../../lib/i18n.tsx'
import { parseQuality, qualityForm, resolutionLabel, type QualityForm } from '../../lib/quality.ts'
import { Segmented, Switch } from '../../ui/controls.tsx'
import { Field, TextField } from '../../ui/fields.tsx'
import { Empty } from '../../ui/Empty.tsx'
import { SeasonOrbit, EpisodeApproach } from './episodes.tsx'
import { ConfirmDialog, Modal } from '../../ui/Modal.tsx'
import { useToast } from '../../ui/toast.tsx'
import { useDevice } from '../DeviceContext.tsx'
import { useLockedRun, useRun } from '../useRun.ts'
import { intervalLabel, QualityFields } from './qualityFields.tsx'

const INTERVALS = [60, 180, 360, 720, 1440, 4320, 10080]

/** Films and anything else to wait for a release of: the list, and adding one. */
export function WatchesSection({ start, onStarted }: { start: WatchInput | null; onStarted: () => void }) {
  const t = useT()
  const { watches } = useDevice()
  const [editing, setEditing] = useState<WatchDto | 'new' | null>(null)
  const [draft, setDraft] = useState<WatchInput | null>(null)
  // Opened from Search with its query filled in.
  useEffect(() => {
    if (!start) return
    setDraft(start)
    setEditing('new')
    onStarted()
  }, [start, onStarted])

  const add = <button type="button" className="infall-button" onClick={() => { setDraft(null); setEditing('new') }}>{t('watch.add')}</button>
  return (
    <>
      {watches.length === 0 ? (
        <Empty appearance="download" title={t('watch.emptyTitle')} text={t('watch.emptyHint')}>{add}</Empty>
      ) : (
        <>
          <div className="mb-4 flex justify-end">{add}</div>
          <ul className="series-shows release-watches">
            {watches.map(watch => <WatchCard key={watch.id} watch={watch} onEdit={() => { setDraft(null); setEditing(watch) }} />)}
          </ul>
        </>
      )}
      <WatchDialog watch={editing} draft={draft} onClose={() => setEditing(null)} />
    </>
  )
}

function WatchCard({ watch, onEdit }: { watch: WatchDto; onEdit: () => void }) {
  const t = useT()
  const formatBytes = useFormatBytes()
  const formatRelative = useFormatRelative('long')
  const toast = useToast()
  const run = useRun()
  const { connection, basePath } = useDevice()
  const { busy, run: lockedRun } = useLockedRun()
  const [deleting, setDeleting] = useState(false)
  const rules = [
    resolutionLabel(watch.resolution),
    watch.maxSizeMb !== null && t('watch.upTo', formatBytes(watch.maxSizeMb * 1024 * 1024, 0)),
    watch.minSeeders > 1 && t('watch.seedersAtLeast', watch.minSeeders),
    watch.preferWords && t('watch.prefers', watch.preferWords),
    watch.autoDownload ? t('watch.autoDownload') : t('watch.notifyOnly'),
  ].filter(Boolean).join(', ')

  const act = async (kind: 'check' | 'download') => {
    const done = await lockedRun(() => connection.call(kind === 'check' ? 'watches.checkNow' : 'watches.download', { id: watch.id }), 'watch.failed')
    if (done && kind === 'check') toast(('found' in done && done.found) ? t('watch.foundToast') : t('watch.nothingYet'), 'info')
    if (done && kind === 'download') toast(t('search.started', watch.found?.title ?? ''), 'success')
  }
  const rearm = (enabled: boolean) => void run(() => connection.call('watches.update', { id: watch.id, watch: { ...toInput(watch), enabled } }), 'settings.saveFailed')

  let action
  if (watch.found && watch.downloadId !== null) action = <Link to={basePath || '/'} className="infall-small">{t('watch.downloading')}</Link>
  else if (watch.found) action = <button type="button" className="infall-button" disabled={busy} onClick={() => void act('download')}>{t('common.download')}</button>
  else action = <button type="button" className="infall-small" disabled={busy || !watch.enabled} onClick={() => void act('check')}>{busy ? t('search.searching') : t('series.checkNow')}</button>

  return (
    <li className="release-watch">
      <SeasonOrbit episodes={[]} total={0} label={watch.query} />
      <div className="show-body"><h2>{watch.query}</h2>
        <p>{watch.found ? watch.found.title : !watch.enabled ? t('series.pausedHint') : t(watch.resolution ? 'watch.waitingRelease' : 'watch.waitingAny', resolutionLabel(watch.resolution) || '')}</p>
        <p className="rule">{watch.autoDownload ? t('watch.arrivesAutomatically') : t('watch.notifyOnly')} {watch.lastCheckedAt ? t('series.checkedAgo', formatRelative(watch.lastCheckedAt)) : t('series.notCheckedYet')}</p>
        {watch.found && <p className="file-meta"><span>{formatBytes(watch.found.sizeBytes)}</span><span>{t('search.seeders', watch.found.seeders)}</span><span>{watch.found.source}</span><span>{t('watch.foundAt', formatRelative(watch.found.foundAt))}</span></p>}
        <details className="series-tools"><summary>{t('common.edit')}</summary><div className="infall-acts">
          <p className="series-rule-details">{rules}, {t('series.everyN', intervalLabel(t, watch.checkIntervalMinutes))}</p>
          {!watch.found && <Switch label={t('series.enabled')} checked={watch.enabled} onChange={rearm} />}
          {watch.found && <button type="button" className="infall-small" onClick={() => rearm(true)} title={t('watch.againHint')}><RotateCcw size={14} />{t('watch.again')}</button>}
          <button type="button" className="infall-small" onClick={onEdit}>{t('common.edit')}</button>
          <button type="button" className="infall-small" aria-label={t('watch.delete')} onClick={() => setDeleting(true)}><Trash2 size={16} /></button>
        </div></details>
      </div>
      <EpisodeApproach episodes={[]} />
      {action}
      {deleting && <ConfirmDialog open title={t('watch.delete')} message={t('watch.deleteConfirm', watch.query)}
        options={[{ label: t('common.cancel'), value: false, tone: 'ghost' }, { label: t('common.delete'), value: true, tone: 'error' }]}
        onResult={confirmed => {
          setDeleting(false)
          if (confirmed) void run(() => connection.call('watches.delete', { id: watch.id }))
        }} />}
    </li>
  )
}

function toInput(watch: WatchDto): WatchInput {
  return {
    query: watch.query, resolution: watch.resolution, minSeeders: watch.minSeeders, maxSizeMb: watch.maxSizeMb,
    preferWords: watch.preferWords, excludeWords: watch.excludeWords, autoDownload: watch.autoDownload,
    checkIntervalMinutes: watch.checkIntervalMinutes, enabled: watch.enabled,
  }
}

interface Form extends QualityForm {
  query: string
  autoDownload: boolean
  checkIntervalMinutes: number
}

function formFor(input: WatchInput | null): Form {
  return {
    ...qualityForm(input),
    query: input?.query ?? '',
    autoDownload: input?.autoDownload ?? false,
    checkIntervalMinutes: input?.checkIntervalMinutes ?? 360,
  }
}

function WatchDialog({ watch, draft, onClose }: { watch: WatchDto | 'new' | null; draft: WatchInput | null; onClose: () => void }) {
  const t = useT()
  const run = useRun()
  const toast = useToast()
  const { connection } = useDevice()
  const existing = watch === 'new' ? null : watch
  const [form, setForm] = useState(() => formFor(null))
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    if (watch) setForm(formFor(existing ? toInput(existing) : draft))
    // Resets whenever the dialog opens for another watch.
  }, [watch, draft])

  const set = <K extends keyof Form>(key: K) => (value: Form[K]) => setForm(f => ({ ...f, [key]: value }))
  const quality = parseQuality(form)
  const invalid = form.query.trim().length < 2 || quality.invalid

  const save = async () => {
    const input: WatchInput = {
      query: form.query.trim(),
      ...quality.values,
      autoDownload: form.autoDownload,
      checkIntervalMinutes: form.checkIntervalMinutes,
      enabled: existing ? existing.enabled : true,
    }
    setSaving(true)
    const saved = existing
      ? await run(() => connection.call('watches.update', { id: existing.id, watch: input }), 'settings.saveFailed')
      : await run(() => connection.call('watches.create', input), 'settings.saveFailed')
    setSaving(false)
    if (!saved) return
    if (!existing) toast(t('watch.createdToast'), 'info')
    onClose()
  }
  const intervals = INTERVALS.includes(form.checkIntervalMinutes) ? INTERVALS : [...INTERVALS, form.checkIntervalMinutes].sort((a, b) => a - b)

  return (
    <Modal open={watch !== null} title={existing ? t('watch.editTitle') : t('watch.add')} icon={<BellRing size={20} />} onClose={onClose} wide
      actions={<>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>{t('common.cancel')}</button>
        <button type="button" className="btn btn-primary btn-sm" disabled={invalid || saving} onClick={() => void save()}>
          {saving && <span className="loading loading-spinner loading-xs" />}{existing ? t('common.save') : t('watch.add')}
        </button>
      </>}>
      <div className="flex flex-col gap-4">
        <TextField label={t('watch.query')} help={t('watch.queryHelp')} value={form.query} onChange={set('query')} maxLength={200} data-autofocus />
        <QualityFields form={form} set={set} kind="watch" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t('series.checkEvery')}>
            <select className="select w-full" value={form.checkIntervalMinutes} onChange={e => set('checkIntervalMinutes')(Number(e.target.value))}>
              {intervals.map(m => <option key={m} value={m}>{intervalLabel(t, m)}</option>)}
            </select>
          </Field>
          <Field label={t('watch.whenFound')}>
            <Segmented label={t('watch.whenFound')} value={form.autoDownload ? 'download' : 'notify'} onChange={v => set('autoDownload')(v === 'download')}
              options={[{ value: 'notify', label: t('watch.tellMe') }, { value: 'download', label: t('watch.downloadIt') }]} />
          </Field>
        </div>
      </div>
    </Modal>
  )
}
