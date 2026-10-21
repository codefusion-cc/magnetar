import { LanesSky } from '../../ui/sky/Sky.tsx'
import type { DownloadDto, DownloadFileDto } from '@magnetar/protocol'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router'
import { isFinished } from '../../lib/downloadViews.ts'
import { downloadDay, noPeersError, searchForName } from '../../lib/downloadPresentation.ts'
import { useSteadySpeeds } from '../../lib/steadySpeed.ts'
import { errorMessage } from '../../lib/errors.ts'
import { isWithin, separatorOf } from '../../lib/folderPaths.ts'
import type { FilesLocation } from '../pages/FilesPage.tsx'
import { formatters, useFormatBytes, useFormatDate, useLanguage, useT } from '../../lib/i18n.tsx'
import { useConnection, useDevice, useDownload, useDownloadRead } from '../DeviceContext.tsx'
import { useLockedRun, useRun } from '../useRun.ts'
import { DownloadActions, DownloadFacts, ProgressBar, ratioOf } from './downloads.tsx'
import { WindowedRows } from '../../ui/WindowedRows.tsx'
import { PlayerDialog, subtitlesFor, type PlayTarget } from './player.tsx'

/** A download's page opened from a row's Play: it plays as soon as its files are read. */
export interface DownloadLocation { play?: boolean }

/** While the download is running, the file list's progress is read again this often. */
const REFRESH_MS = 2000

export function DownloadDetailsPage() {
  const { id } = useParams()
  const t = useT()
  const { basePath } = useDevice()
  const read = useDownloadRead()
  const download = useDownload(id && /^\d+$/.test(id) ? Number(id) : undefined)
  const back = <p className="download-back"><Link to={basePath || '/'}>{t('details.allDownloads')}</Link></p>
  if (read.failed) return <>{back}<div role="alert"><p>{t('downloads.readFailed')}</p><button type="button" className="infall-small" onClick={read.retry}>{t('common.retry')}</button></div></>
  if (download) return <>{back}<Details key={download.id} download={download} /></>
  return <>{back}<p role="status" className="muted">{t(read.loading ? 'details.filesLoading' : 'details.notFound')}</p></>
}

function Details({ download: d }: { download: DownloadDto }) {
  const t = useT()
  const language = useLanguage()
  const date = useFormatDate()
  const run = useRun()
  const { connection, info, settings, basePath } = useDevice()
  const bytes = useFormatBytes()
  const speeds = useSteadySpeeds(useMemo(() => [d], [d])).get(d.id)!
  const local = connection.kind === 'local'
  const browsable = info?.fileBrowser === true && !!settings && isWithin(d.savePath, settings.downloadFolder, separatorOf(settings.downloadFolder))
  const location = useLocation()
  const navigate = useNavigate()
  const [play, setPlay] = useState(() => (location.state as DownloadLocation | null)?.play === true)
  // Played once: going back to this page or reloading it does not play again.
  const onPlayed = useCallback(() => {
    setPlay(false)
    if ((location.state as DownloadLocation | null)?.play) void navigate(location.pathname + location.search, { replace: true, state: null })
  }, [location, navigate])
  const [canPlay, setCanPlay] = useState(false)
  const failed = d.status === 'Error'
  const hasMetadata = d.totalBytes > 0
  const facts: [string, string][] = [
    [t(failed ? 'details.willSave' : 'details.savedTo'), d.savePath],
    [t('details.added'), downloadDay(language, d.addedAt, true)],
    [t('details.foundOn'), d.source || '—'],
    failed && !hasMetadata ? [t('details.filesHeading'), t('details.filesPending')] : [t('details.sentBack'), t('details.sentRatio', bytes(d.uploadedBytes), formatters(language).number(ratioOf(d), { maximumFractionDigits: 2, minimumFractionDigits: 2 }))],
  ]
  return <article className="download-one">
    <LanesSky one><header className="download-one-heading"><h1 className="break-release">{d.name}</h1><ProgressBar download={d} /><DownloadFacts download={d} {...speeds} /></header></LanesSky>
    {failed && noPeersError(d.error) && <p className="download-lead">{t('details.noPeersHint')}</p>}
    <div className="infall-acts">
      {!failed && d.totalBytes > 0 && <button type="button" className="infall-button" disabled={!canPlay} title={!canPlay ? t('details.filesPending') : undefined} onClick={() => setPlay(true)}>{t('details.play')}</button>}
      <DownloadActions download={d} remove={failed} prominent={failed} between={failed ? <Link className="infall-small" to={basePath + searchForName(d.name)}>{t('details.searchForIt')}</Link> : undefined} />
      {!failed && <>
        <button type="button" disabled={!local} title={!local ? t('details.revealLocal') : undefined} className="infall-small" onClick={() => void run(() => connection.call('downloads.reveal', { id: d.id }))}>{t(info?.platform === 'macos' ? 'details.finder' : 'details.reveal')}</button>
        {browsable && <Link className="infall-small" to={`${basePath}/files`} state={{ path: d.savePath } satisfies FilesLocation}>{t('files.showInFiles')}</Link>}
      </>}
    </div>
    <dl className="download-facts">{facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd title={label === t('details.added') ? date(d.addedAt, true) : undefined}>{value}</dd></div>)}</dl>
    {(!failed || hasMetadata) && <FileList id={d.id} status={d.status} hasMetadata={d.totalBytes > 0} play={play} onPlayable={setCanPlay} onPlayed={onPlayed} />}
  </article>
}

/** The torrent's files with a checkbox each; the choice is saved with one button, not per click. */
const FileList = memo(function FileList({ id, status, hasMetadata, play, onPlayable, onPlayed }: { id: number; status: DownloadDto['status']; hasMetadata: boolean; play: boolean; onPlayable: (playable: boolean) => void; onPlayed: () => void }) {
  const t = useT()
  const formatBytes = useFormatBytes()
  const { busy: saving, run, isBusy } = useLockedRun()
  const connection = useConnection()
  const [files, setFiles] = useState<DownloadFileDto[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [chosen, setChosen] = useState<Map<number, boolean>>(new Map())
  const [playing, setPlaying] = useState<PlayTarget | null>(null)
  const revision = useRef(0)
  const [retry, setRetry] = useState(0)
  const running = status === 'Downloading' || status === 'Seeding'

  useEffect(() => {
    if (!hasMetadata) return
    let cancelled = false
    let inFlight = false
    const load = async () => {
      if (inFlight || isBusy()) return
      const started = revision.current
      inFlight = true
      try {
        const list = await connection.call('downloads.files', { id })
        if (!cancelled && started === revision.current) { setFiles(list); setError(null) }
      } catch (e) { if (!cancelled && started === revision.current) setError(errorMessage(e)) }
      finally { inFlight = false }
    }
    void load()
    const timer = running ? setInterval(() => void load(), REFRESH_MS) : undefined
    return () => { cancelled = true; clearInterval(timer) }
  }, [connection, id, running, hasMetadata, retry, isBusy])

  const fileKey = useCallback((index: number) => files![index]!.index, [files])
  const selected = useMemo(() => new Set(files?.filter(f => chosen.get(f.index) ?? f.selected).map(f => f.index)), [chosen, files])
  const dirty = files !== null && files.some(f => f.selected !== selected.has(f.index))
  const chosenBytes = files?.filter(f => selected.has(f.index)).reduce((sum, f) => sum + f.size, 0) ?? 0
  useEffect(() => { onPlayable(!!files?.some(f => f.media && f.selected && (f.done > 0 || running))) }, [files, running, onPlayable])
  useEffect(() => {
    if (!play || !files) return
    const file = files.find(f => f.media && f.selected && (f.done > 0 || running))
    if (file) setPlaying({ downloadId: id, file, subtitles: subtitlesFor(file, files) })
    onPlayed()
  }, [play, files, running, id, onPlayed])

  if (!hasMetadata) return <p className="muted text-sm">{t('details.filesPending')}</p>
  if (error && !files) return <div role="alert"><p className="setting-alert">{error}</p><button type="button" className="infall-small" onClick={() => setRetry(n => n + 1)}>{t('common.retry')}</button></div>
  if (!files) return <p role="status" className="muted">{t('details.filesLoading')}</p>

  const toggle = (index: number) => setChosen(current => new Map(current).set(index, !selected.has(index)))
  const save = async () => {
    const submitted = new Set(selected)
    await run(async () => {
      revision.current++
      const updated = await connection.call('downloads.selectFiles', { id, files: [...submitted] })
      if (updated) {
        setChosen(new Map())
        setFiles(list => list?.map(f => ({ ...f, selected: submitted.has(f.index) })) ?? null)
      }
    }, 'details.selectFailed')
  }

  return (
    <section aria-labelledby="magnetar-files">
      <div className="download-files-heading">
        <h2 id="magnetar-files" className="flex-1">{t('details.filesHeading')}</h2>
        {files.length > 1 && (
          <button type="button" className="download-text-action" disabled={saving} onClick={() => setChosen(new Map(files.map(f => [f.index, selected.size !== files.length])))}>
            {selected.size === files.length ? t('details.selectNone') : t('details.selectAll')}
          </button>
        )}
      </div>
      {files.length === 0 && <p className="muted">{t('details.filesPending')}</p>}
      {error && <p role="alert" className="setting-alert">{error}</p>}
      {files.length > 0 && <WindowedRows label={t('details.filesHeading')} count={files.length} getKey={fileKey} className="download-files" rowClassName="download-file"
        renderRow={index => {
          const file = files[index]!
          const percent = file.size > 0 ? Math.round((file.done / file.size) * 100) : 100
          return <>
            <div className="download-file-label">
              <input type="checkbox" disabled={saving} checked={selected.has(file.index)}
                aria-label={t('details.fileChoose', file.path)} onChange={() => toggle(file.index)} />
              {file.media && file.selected && (file.done > 0 || running) ? <button type="button" className="text-left hover:underline" title={file.path} aria-label={t('player.play', file.path)} onClick={() => setPlaying({ downloadId: id, file, subtitles: subtitlesFor(file, files) })}>{file.path}</button> : <span title={file.path}>{file.path}</span>}
            </div>
            <div className="download-file-size">{formatBytes(file.size)}</div>
            <span className="download-file-state">{!selected.has(file.index) ? t('details.skipped') : percent === 100 ? t('details.fileDone') : `${percent}%`}</span>
          </>
        }} />}
      {dirty && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="muted flex-1 text-sm">{selected.size === 0 ? t('details.chooseOne') : t('details.chosenSize', selected.size, formatBytes(chosenBytes))}</span>
          <button type="button" className="infall-small" disabled={saving} onClick={() => setChosen(new Map())}>{t('common.cancel')}</button>
          <button type="button" className="infall-button" disabled={saving || selected.size === 0} onClick={() => void save()}>
            {t('details.saveFiles')}
          </button>
        </div>
      )}
      <PlayerDialog target={playing} finished={isFinished({ status })} onClose={() => setPlaying(null)} />
    </section>
  )
})
