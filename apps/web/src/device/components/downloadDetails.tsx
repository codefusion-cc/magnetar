import type { DownloadDto, DownloadFileDto } from '@magnetar/protocol'
import { FileAudio, FileText, FileVideo } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { downloadBytes, downloadDay } from '../../lib/downloadPresentation.ts'
import { useSteadySpeeds } from '../../lib/steadySpeed.ts'
import { errorMessage } from '../../lib/errors.ts'
import { isWithin, separatorOf } from '../../lib/folderPaths.ts'
import type { FilesLocation } from '../pages/FilesPage.tsx'
import { useFormatDate, useLanguage, useT } from '../../lib/i18n.tsx'
import { useDevice, useDownloads, useDownloadRead } from '../DeviceContext.tsx'
import { useRun } from '../useRun.ts'
import { DownloadActions, DownloadFacts, isFinished, ProgressBar, ratioOf } from './downloads.tsx'
import { PlayerDialog, subtitlesFor, type PlayTarget } from './player.tsx'

/** While the download is running, the file list's progress is read again this often. */
const REFRESH_MS = 2000

/** Older callers that opened details now navigate to the same address as the list. */
export function DownloadDetailsDialog({ id, onClose }: { id: number | null; onClose: () => void }) {
  const navigate = useNavigate()
  const { basePath } = useDevice()
  useEffect(() => {
    if (id === null) return
    navigate(`${basePath}/downloads/${id}`)
    onClose()
  }, [id, basePath, navigate, onClose])
  return null
}

export function DownloadDetailsPage() {
  const { id } = useParams()
  const t = useT()
  const { basePath } = useDevice()
  const downloads = useDownloads()
  const read = useDownloadRead()
  const download = downloads.find(d => String(d.id) === id)
  return <>
    <p className="download-back"><Link to={basePath || '/'}>{t('details.allDownloads')}</Link></p>
    {read.failed ? <div role="alert"><p>{t('downloads.readFailed')}</p><button type="button" className="infall-small" onClick={read.retry}>{t('downloads.tryAgain')}</button></div> : download ? <Details key={download.id} download={download} /> : <p role="status" className="muted">{t(read.loading ? 'details.filesLoading' : 'details.notFound')}</p>}
  </>
}

function Details({ download: d }: { download: DownloadDto }) {
  const t = useT()
  const language = useLanguage()
  const date = useFormatDate()
  const run = useRun()
  const { connection, info, settings, basePath } = useDevice()
  const bytes = (n: number) => downloadBytes(n, language)
  const speeds = useSteadySpeeds(useMemo(() => [d], [d])).get(d.id)!
  const local = connection.kind === 'local'
  const browsable = info?.fileBrowser === true && !!settings && isWithin(d.savePath, settings.downloadFolder, separatorOf(settings.downloadFolder))
  const [play, setPlay] = useState(false)
  const failed = d.status === 'Error'
  const facts: [string, string][] = [
    [t(failed ? 'details.willSave' : 'details.savedTo'), d.savePath],
    [t('details.added'), downloadDay(t, language, d.addedAt, true)],
    [t('details.foundOn'), d.source || '—'],
    failed ? [t('details.filesHeading'), t('details.filesPending')] : [t('details.sentBack'), t('details.sentRatio', bytes(d.uploadedBytes), new Intl.NumberFormat(language, { maximumFractionDigits: 2, minimumFractionDigits: 2 }).format(ratioOf(d)))],
  ]
  return <article className="download-one">
    <header className="download-one-heading"><h1 className="break-release">{d.name}</h1><ProgressBar download={d} /><DownloadFacts download={d} {...speeds} /></header>
    {failed && <p className="download-lead">{t('details.noPeersHint')}</p>}
    <div className="infall-acts">
      {!failed && d.totalBytes > 0 && <button type="button" className="infall-button" onClick={() => setPlay(true)}>{t('details.play')}</button>}
      <DownloadActions download={d} remove={failed} />
      {failed ? <Link className="infall-small" to={`${basePath}/search/${encodeURIComponent(d.name)}`}>{t('details.searchForIt')}</Link> : <>
        {<button type="button" disabled={!local} title={!local ? t('details.revealLocal') : undefined} className="infall-small" onClick={() => void run(() => connection.call('downloads.reveal', { id: d.id }))}>{t(info?.platform === 'macos' ? 'details.finder' : 'details.reveal')}</button>}
        {browsable && <Link className="infall-small" to={`${basePath}/files`} state={{ path: d.savePath } satisfies FilesLocation}>{t('files.showInFiles')}</Link>}
      </>}
    </div>
    <dl className="download-facts">{facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd title={label === t('details.added') ? date(d.addedAt, true) : undefined}>{value}</dd></div>)}</dl>
    {!failed && <FileList download={d} play={play} onPlayed={() => setPlay(false)} />}
  </article>
}

/** A file's icon by what a browser can play of it, the same in a download's details and in Files. */
export function MediaIcon({ media, size = 16 }: { media: 'video' | 'audio' | null; size?: number }) {
  if (media === 'audio') return <FileAudio size={size} className="shrink-0 text-accent-2" aria-hidden />
  if (media === 'video') return <FileVideo size={size} className="shrink-0 text-info" aria-hidden />
  return <FileText size={size} className="muted shrink-0" aria-hidden />
}

/** The torrent's files with a checkbox each; the choice is saved with one button, not per click. */
function FileList({ download: d, play, onPlayed }: { download: DownloadDto; play: boolean; onPlayed: () => void }) {
  const t = useT()
  const language = useLanguage()
  const formatBytes = (n: number) => downloadBytes(n, language)
  const run = useRun()
  const { connection } = useDevice()
  const [files, setFiles] = useState<DownloadFileDto[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [chosen, setChosen] = useState<Map<number, boolean>>(new Map())
  const [saving, setSaving] = useState(false)
  const [playing, setPlaying] = useState<PlayTarget | null>(null)
  const revision = useRef(0)
  const [retry, setRetry] = useState(0)
  const saveLock = useRef(false)
  const running = d.status === 'Downloading' || d.status === 'Seeding'
  const hasMetadata = d.totalBytes > 0

  useEffect(() => {
    if (!hasMetadata) return
    let cancelled = false
    let inFlight = false
    const load = async () => {
      if (inFlight || saveLock.current) return
      const started = revision.current
      inFlight = true
      try {
        const list = await connection.call('downloads.files', { id: d.id })
        if (!cancelled && started === revision.current) { setFiles(list); setError(null) }
      } catch (e) { if (!cancelled && started === revision.current) setError(errorMessage(e)) }
      finally { inFlight = false }
    }
    void load()
    const timer = running ? setInterval(() => void load(), REFRESH_MS) : undefined
    return () => { cancelled = true; clearInterval(timer) }
  }, [connection, d.id, running, hasMetadata, retry])

  const selected = useMemo(() => new Set(files?.filter(f => chosen.get(f.index) ?? f.selected).map(f => f.index)), [chosen, files])
  const dirty = files !== null && files.some(f => f.selected !== selected.has(f.index))
  const chosenBytes = files?.filter(f => selected.has(f.index)).reduce((sum, f) => sum + f.size, 0) ?? 0
  useEffect(() => {
    if (!play || !files) return
    const file = files.find(f => f.media && f.selected && (f.done > 0 || running))
    if (file) setPlaying({ downloadId: d.id, file, subtitles: subtitlesFor(file, files) })
    onPlayed()
  }, [play, files, running, d.id, onPlayed])

  if (!hasMetadata) return <p className="muted text-sm">{t('details.filesPending')}</p>
  if (error && !files) return <div role="alert"><p className="text-error">{error}</p><button type="button" className="infall-small" onClick={() => setRetry(n => n + 1)}>{t('downloads.tryAgain')}</button></div>
  if (!files) return <p role="status" className="muted">{t('details.filesLoading')}</p>

  const toggle = (index: number) => setChosen(current => new Map(current).set(index, !selected.has(index)))
  const save = async () => {
    if (saveLock.current) return
    saveLock.current = true
    revision.current++
    setSaving(true)
    const submitted = new Set(selected)
    try {
      const updated = await run(() => connection.call('downloads.selectFiles', { id: d.id, files: [...submitted] }), 'details.selectFailed')
      if (updated) {
        setChosen(new Map())
        setFiles(list => list?.map(f => ({ ...f, selected: submitted.has(f.index) })) ?? null)
      }
    } finally { saveLock.current = false; setSaving(false) }
  }

  return (
    <section aria-labelledby="magnetar-files">
      <div className="mb-2 flex items-center gap-2">
        <h2 id="magnetar-files" className="flex-1">{t('details.filesHeading')}</h2>
        {files.length > 1 && (
          <button type="button" className="download-text-action" disabled={saving} onClick={() => setChosen(new Map(files.map(f => [f.index, selected.size !== files.length])))}>
            {selected.size === files.length ? t('details.selectNone') : t('details.selectAll')}
          </button>
        )}
      </div>
      <>{files.length === 0 && <p className="muted">{t('details.filesPending')}</p>}{error && <p role="alert" className="text-error">{error}</p>}<ul className="download-files">
        {files.map(file => {
          const percent = file.size > 0 ? Math.round((file.done / file.size) * 100) : 100
          return (
            <li key={file.index} className="download-file">
              <div className="download-file-label">
                <input type="checkbox" disabled={saving} checked={selected.has(file.index)}
                  aria-label={t('details.fileChoose', file.path)} onChange={() => toggle(file.index)} />
              {file.media && file.selected && (file.done > 0 || running) ? <button type="button" className="break-release text-left hover:underline" aria-label={t('player.play', file.path)} onClick={() => setPlaying({ downloadId: d.id, file, subtitles: subtitlesFor(file, files) })}>{file.path}</button> : <span className="break-release">{file.path}</span>}</div>
              <div className="download-file-size">
                {formatBytes(file.size)}
              </div>
              <span className="download-file-state">{!selected.has(file.index) ? t('details.skipped') : percent === 100 ? t('details.fileDone') : `${percent}%`}</span>

            </li>
          )
        })}
      </ul></>
      {dirty && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="muted flex-1 text-sm">{selected.size === 0 ? t('details.chooseOne') : t('details.chosenSize', selected.size, formatBytes(chosenBytes))}</span>
          <button type="button" className="infall-small" disabled={saving} onClick={() => setChosen(new Map())}>{t('common.cancel')}</button>
          <button type="button" className="infall-button" disabled={saving || selected.size === 0} onClick={() => void save()}>
            {t('details.saveFiles')}
          </button>
        </div>
      )}
      <PlayerDialog target={playing} finished={isFinished(d)} onClose={() => setPlaying(null)} />
    </section>
  )
}
