import type { DownloadDto, SeriesTaskDto, ShowInfoDto, WatchInput } from '@magnetar/protocol'
import { ChevronDown, ExternalLink, Pencil, Plus, Trash2 } from 'lucide-react'
import { memo, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Navigate, useLocation, useNavigate, useParams } from 'react-router'
import { useFormatRelative, useLanguage, useT } from '../../lib/i18n.tsx'
import { usePathChoice } from '../../lib/urlState.ts'
import { parseQuality, qualityForm, type QualityForm } from '../../lib/quality.ts'
import { Segmented, Switch } from '../../ui/controls.tsx'
import { Field, TextField } from '../../ui/fields.tsx'
import { Empty } from '../../ui/Empty.tsx'
import { Loading } from '../../ui/Loading.tsx'
import { SeasonOrbit, EpisodeApproach } from '../components/episodes.tsx'
import { calendarDistance, episodeAirDate, upcomingEpisodes, seriesLine, seriesRule } from '../../lib/seriesPresentation.ts'
import { ConfirmDialog, Modal } from '../../ui/Modal.tsx'
import { useToast } from '../../ui/toast.tsx'
import { useConnection, useDevice, useDownloads } from '../DeviceContext.tsx'
import { FolderField } from '../components/folders.tsx'
import { intervalLabel, QualityFields } from '../components/qualityFields.tsx'
import { WatchesSection } from '../components/watches.tsx'
import { useLockedRun, useRun } from '../useRun.ts'
import { DownloadList } from './DownloadsPage.tsx'

const INTERVALS = [15, 30, 60, 120, 360, 720, 1440]
const TABS = ['series', 'releases'] as const
type Tab = (typeof TABS)[number]

export function SeriesPage() {
  const t = useT()
  const { series, basePath, seriesRead, deviceName } = useDevice()
  const downloads = useDownloads()
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const tick = () => setNow(Date.now())
    const timer = window.setInterval(tick, 60_000)
    window.addEventListener('focus', tick)
    return () => { window.clearInterval(timer); window.removeEventListener('focus', tick) }
  }, [])
  const [editing, setEditing] = useState<SeriesTaskDto | 'new' | null>(null)
  // One pass per update; each card keeps its list until one of its own downloads changes.
  const byTask = useMemo(() => {
    const groups = new Map<number, DownloadDto[]>()
    for (const d of downloads) {
      if (d.seriesTaskId === null) continue
      const group = groups.get(d.seriesTaskId)
      if (group) group.push(d)
      else groups.set(d.seriesTaskId, [d])
    }
    return groups
  }, [downloads])
  const add = <button type="button" className="infall-button" onClick={() => setEditing('new')}>{t('series.add')}</button>
  const waitForRelease = <button className="infall-button quiet" onClick={() => navigate(href('releases'), { state: { watch: {} } })}>{t('watch.add')}</button>
  // The tab is part of the path: /series and /series/releases.
  const { value: tab, redirect } = usePathChoice(useParams().tab, TABS, 'tab')
  const href = (to: Tab) => `${basePath}/series${to === 'releases' ? '/releases' : ''}`
  const navigate = useNavigate()
  const location = useLocation()
  // Search hands over "watch for this" with its query.
  const [handed, setHanded] = useState<WatchInput | null>((location.state as { watch?: WatchInput } | null)?.watch ?? null)
  useEffect(() => { setHanded((location.state as { watch?: WatchInput } | null)?.watch ?? null) }, [location.key])
  const clearHanded = useCallback(() => setHanded(null), [])

  if (redirect) return <Navigate to={href(redirect)} replace state={location.state} />

  return (
    <>
      <header className="downloads-heading watch-heading"><h1>{t('watch.pageTitle')}</h1>
        {(tab === 'series' && !seriesRead.loading && (series.length > 0 || seriesRead.failed)) && <div className="infall-acts">{add}{waitForRelease}</div>}
      </header>
      <div className="watch-tabs"><Segmented appearance="quiet" label={t('watch.pageTitle')} value={tab} onChange={next => navigate(href(next))}
        options={[{ value: 'series', label: t('series.title') }, { value: 'releases', label: t('watch.tab') }]} /></div>
      {tab === 'releases' ? <WatchesSection start={handed} onStarted={clearHanded} /> : seriesRead.loading ? <Loading text={t('series.reading')} rows={3} />
        : seriesRead.failed ? <Empty appearance="download" role="alert" state="far" title={t('series.readFailed')} text={t('series.readFailedHint', deviceName)}>
          <button className="infall-button" onClick={seriesRead.retry}>{t('downloads.tryAgain')}</button>
        </Empty> : series.length === 0 ? <Empty appearance="download" title={t('series.emptyTitle')} text={t('series.emptyHint')}>
          <div className="infall-acts">{add}{waitForRelease}</div>
        </Empty> : <ul aria-label={t('series.title')} className="series-shows">
        {series.map(task => <SeriesCard key={task.id} now={now} task={task} downloads={byTask.get(task.id) ?? NONE} onEdit={setEditing} />)}
      </ul>}
      <SeriesDialog task={editing} onClose={() => setEditing(null)} />
    </>
  )
}

const NONE: DownloadDto[] = []
const sameRows = (a: DownloadDto[], b: DownloadDto[]) => a.length === b.length && a.every((d, i) => d === b[i])

/** Posters by task and show, kept for the page's lifetime: they only change with the show. */
const posters = new Map<string, Promise<string | null>>()

function usePoster(taskId: number, show: ShowInfoDto | null): string | null {
  const connection = useConnection()
  const [poster, setPoster] = useState<string | null>(null)
  const key = show?.hasPoster ? `${taskId}:${show.tvmazeId}` : null
  useEffect(() => {
    if (!key) return setPoster(null)
    let cancelled = false
    if (!posters.has(key)) {
      posters.set(key, connection.call('series.poster', { id: taskId }).then(r => (r.data ? `data:image/jpeg;base64,${r.data}` : null)).catch(() => {
        posters.delete(key)
        return null
      }))
    }
    void posters.get(key)!.then(url => { if (!cancelled) setPoster(url) })
    return () => { cancelled = true }
  }, [connection, key, taskId])
  return poster
}

function ShowMetadata({ task }: { task: SeriesTaskDto }) {
  const t = useT()
  const poster = usePoster(task.id, task.show)
  return <div className="series-metadata">{poster && <img src={poster} alt="" width="64" height="96" />}{task.show?.network && <p>{task.show.network}</p>}{task.show?.status === 'Ended' && <p>{t('series.ended')}</p>}</div>
}

const SeriesCard = memo(function SeriesCard({ task, downloads, onEdit, now }: {
  task: SeriesTaskDto
  now: number
  downloads: DownloadDto[]
  onEdit: (task: SeriesTaskDto) => void
}) {
  const t = useT()
  const formatRelative = useFormatRelative('long')
  const toast = useToast()
  const run = useRun()
  const connection = useConnection()
  const { busy: checking, run: lockedRun } = useLockedRun()
  const [deleting, setDeleting] = useState(false)
  const [showMetadata, setShowMetadata] = useState(false)
  const [showDownloads, setShowDownloads] = useState(false)

  const checkNow = async () => {
    const done = await lockedRun(() => connection.call('series.checkNow', { id: task.id }), 'series.checkFailed')
    if (done) toast(t('series.checkDone'), 'info')
  }

  const language = useLanguage()
  const episodes = task.episodes?.episodes ?? []
  const got = episodes.filter(e => e.state === 'have').length
  const total = task.episodes?.total ?? (task.endEpisode === null ? 0 : task.endEpisode - task.startEpisode + 1)
  const active = episodes.find(e => e.state === 'downloading')
  const activeDownload = active ? downloads.find(d => d.id === active.downloadId) : undefined
  const { future, next, expected, date } = useMemo(() => {
    const future = upcomingEpisodes(episodes, now)
    const expected = episodes.find(e => e.state === 'expected' && e.number >= task.nextEpisode)
    const next = active ? upcomingEpisodes(episodes, now, Infinity).find(e => e.state === 'expected') : expected
    const date = next?.airstamp && calendarDistance(next.airstamp, now) >= 0 ? episodeAirDate(next.airstamp, language, t, Boolean(active)) : null
    return { future, next, expected, date }
  }, [task.episodes, task.nextEpisode, now, language, t])
  const checked = task.lastCheckedAt ? t('series.checkedAgo', formatRelative(task.lastCheckedAt)) : t('series.notCheckedYet')
  const line = seriesLine(t, { task, got, total, active, activeStatus: activeDownload?.status, next, expected, date, checked })
  const rule = seriesRule(t, task, got, total)
  const show = task.show
  return (
    <li className={task.enabled || task.finished ? '' : 'series-paused'}>
      <SeasonOrbit progress={activeDownload?.progress ?? 0} episodes={episodes} total={total} label={t(total === 1 ? 'series.progressOne' : 'series.progress', got, total)} />
      <div className="show-body"><h2>{task.name || t('series.unnamed')}</h2><p>{line}</p><p className="rule">{rule}</p>
        <details className="series-tools" onToggle={e => setShowMetadata(e.currentTarget.open)}><summary>{t('common.edit')}</summary><div className="infall-acts">
          <p className="series-rule-details">{[task.titleFilter, task.provider, t('series.everyN', intervalLabel(t, task.checkIntervalMinutes)), task.lastCheckedAt ? t('series.checkedAgo', formatRelative(task.lastCheckedAt)) : t('series.notCheckedYet')].filter(Boolean).join(', ')}</p>
          {downloads.some(d => d.status === 'Error') && <p className="text-warning">{t('series.failedHint', downloads.filter(d => d.status === 'Error').length)}</p>}
          {showMetadata && <ShowMetadata task={task} />}
          {!task.finished && <Switch label={t('series.enabled')} checked={task.enabled} onChange={enabled => void run(() => connection.call('series.update', { id: task.id, patch: { enabled } }), 'settings.saveFailed')} />}
          <button className="infall-small" onClick={() => onEdit(task)}><Pencil size={14} />{t('common.edit')}</button>
          {downloads.length > 0 && <button className="infall-small" aria-expanded={showDownloads} onClick={() => setShowDownloads(s => !s)}>{t('series.downloads', downloads.length)}<ChevronDown size={14} /></button>}
          {show?.url && <a className="infall-small" href={show.url} target="_blank" rel="noreferrer noopener" aria-label={t('series.onTvmaze')}><ExternalLink size={14} /></a>}
          <button className="infall-small" aria-label={t('series.deleteTask')} onClick={() => setDeleting(true)}><Trash2 size={16} /></button>
        </div></details>
      </div>
      <EpisodeApproach now={now} episodes={future} />
      {!task.finished && <button className="infall-small" disabled={checking} onClick={() => void checkNow()} aria-label={`${t('series.checkNow')}: ${task.name}`}>{checking ? t('search.searching') : t('series.checkNow')}</button>}
      {showDownloads && <div className="mt-3"><DownloadList downloads={downloads} hideSeries /></div>}

      {deleting && <ConfirmDialog open title={t('series.deleteTaskTitle')}
        message={downloads.length > 0 ? t('series.deleteConfirmWithDownloads', task.name, downloads.length) : t('series.deleteConfirm', task.name)}
        options={[{ label: t('common.cancel'), value: false, tone: 'ghost' }, { label: t('common.delete'), value: true, tone: 'error' }]}
        onResult={confirmed => {
          setDeleting(false)
          if (confirmed) void run(() => connection.call('series.delete', { id: task.id }))
        }} />}
    </li>
  )
}, (a, b) => a.now === b.now && a.task === b.task && a.onEdit === b.onEdit && sameRows(a.downloads, b.downloads))

interface Form extends QualityForm {
  name: string
  query: string
  provider: string
  titleFilter: string
  season: string
  startEpisode: string
  endEpisode: string
  checkIntervalMinutes: number
  downloadFolder: string
  startFrom: 'episode' | 'latest' | 'new'
}

function formFor(task: SeriesTaskDto | null): Form {
  return {
    name: task?.name ?? '',
    query: task?.query ?? '',
    provider: task?.provider ?? '',
    titleFilter: task?.titleFilter ?? '',
    season: task?.season === null || task === null ? '' : String(task.season),
    startEpisode: String(task?.startEpisode ?? 1),
    endEpisode: task?.endEpisode == null ? '' : String(task.endEpisode),
    checkIntervalMinutes: task?.checkIntervalMinutes ?? 60,
    downloadFolder: task?.downloadFolder ?? '',
    ...qualityForm(task),
    startFrom: 'episode',
  }
}

/** Create a series task, or edit one; nothing is saved until Save. */
function SeriesDialog({ task, onClose }: { task: SeriesTaskDto | 'new' | null; onClose: () => void }) {
  const t = useT()
  const run = useRun()
  const { connection, sources, settings } = useDevice()
  const existing = task === 'new' ? null : task
  const [form, setForm] = useState(() => formFor(null))
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    if (task) setForm(formFor(existing))
    // The dialog resets whenever it opens for another task.
  }, [task])

  const set = <K extends keyof Form>(key: K) => (value: Form[K]) => setForm(f => ({ ...f, [key]: value }))
  const number = (v: string) => (v.trim() === '' ? null : Math.max(0, Math.trunc(Number(v))))
  const start = number(form.startEpisode) ?? 1
  const end = number(form.endEpisode)
  const quality = parseQuality(form)
  const invalid = !form.query.trim() || (end !== null && end < start) || quality.invalid

  const save = async () => {
    const values = {
      name: form.name.trim() || form.query.trim(),
      query: form.query.trim(),
      provider: form.provider || null,
      titleFilter: form.titleFilter.trim() || null,
      season: number(form.season),
      startEpisode: Math.max(1, start),
      endEpisode: end,
      checkIntervalMinutes: form.checkIntervalMinutes,
      downloadFolder: form.downloadFolder.trim() || null,
      ...quality.values,
    }
    setSaving(true)
    const saved = existing
      ? await run(() => connection.call('series.update', { id: existing.id, patch: values }), 'settings.saveFailed')
      : await run(() => connection.call('series.create', { ...values, enabled: true, startFrom: form.startFrom }), 'settings.saveFailed')
    setSaving(false)
    if (saved) onClose()
  }

  const intervals = INTERVALS.includes(form.checkIntervalMinutes) ? INTERVALS : [...INTERVALS, form.checkIntervalMinutes].sort((a, b) => a - b)

  return (
    <Modal open={task !== null} title={existing ? t('series.editTitle') : t('series.add')} onClose={onClose} wide
      actions={<>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>{t('common.cancel')}</button>
        <button type="button" className="btn btn-primary btn-sm" disabled={invalid || saving} onClick={() => void save()}>
          {saving ? <span className="loading loading-spinner loading-xs" /> : existing ? null : <Plus size={14} />}
          {existing ? t('common.save') : t('series.add')}
        </button>
      </>}>
      <div className="flex flex-col gap-5">
        <FormSection title={t('series.whatTitle')}>
          <TextField label={t('series.query')} help={t('series.queryHelp')} value={form.query} onChange={set('query')} data-autofocus required />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <TextField label={t('series.name')} help={t('series.nameHelp')} value={form.name} placeholder={form.query} onChange={set('name')} />
            <TextField label={t('series.titleFilter')} help={t('series.titleFilterHelp')} value={form.titleFilter} onChange={set('titleFilter')} />
          </div>
        </FormSection>

        <FormSection title={t('series.episodesTitle')}>
          {!existing && (
            <Segmented label={t('series.startFrom')} value={form.startFrom} onChange={set('startFrom')}
              options={[
                { value: 'episode', label: t('series.startFrom.episode') },
                { value: 'latest', label: t('series.startFrom.latest') },
                { value: 'new', label: t('series.startFrom.new') },
              ]} />
          )}
          <div className="grid grid-cols-3 gap-3">
            <TextField label={t('series.season')} type="number" min={0} value={form.season} onChange={set('season')} />
            {(existing || form.startFrom === 'episode') && (
              <TextField label={t('series.startEpisode')} type="number" min={1} value={form.startEpisode} onChange={set('startEpisode')} />
            )}
            <TextField label={t('series.endEpisode')} type="number" min={1} value={form.endEpisode} onChange={set('endEpisode')} />
          </div>
          {end !== null && end < start
            ? <p className="text-sm text-error">{t('series.endBeforeStart')}</p>
            : <p className="muted text-xs">{t('series.episodesHelp')}</p>}
          {!existing && (
            <p className="rounded-field bg-info/10 px-3 py-2 text-sm text-info">
              {form.startFrom === 'episode' ? t('series.backfillHint', start) : t(`series.startFromHint.${form.startFrom}`)}
            </p>
          )}
        </FormSection>

        <FormSection title={t('series.qualityTitle')}>
          <QualityFields form={form} set={set} kind="series" />
        </FormSection>

        <FormSection title={t('series.whereTitle')}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={t('search.source')}>
              <select className="select w-full" value={form.provider} onChange={e => set('provider')(e.target.value)}>
                <option value="">{t('search.allSources')}</option>
                {sources.filter(s => s.enabled || s.name === form.provider).map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
              </select>
            </Field>
            <Field label={t('series.checkEvery')}>
              <select className="select w-full" value={form.checkIntervalMinutes} onChange={e => set('checkIntervalMinutes')(Number(e.target.value))}>
                {intervals.map(m => <option key={m} value={m}>{intervalLabel(t, m)}</option>)}
              </select>
            </Field>
          </div>
          <FolderField label={t('series.folder')} value={form.downloadFolder} placeholder={settings?.downloadFolder}
            help={t('series.folderHelp')} onChange={set('downloadFolder')} />
        </FormSection>
      </div>
    </Modal>
  )
}

function FormSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="muted mb-3 text-xs font-semibold uppercase tracking-wider">{title}</legend>
      {children}
    </fieldset>
  )
}
