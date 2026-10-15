import type { FolderEntryDto, FolderPageDto, FolderRootDto } from '@magnetar/protocol'
import { useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { fileBrowserNotice } from '../../lib/buildVersion.ts'
import { baseName, isWithin, samePath, separatorOf } from '../../lib/folderPaths.ts'
import { useT } from '../../lib/i18n.tsx'
import { BUILD } from '../../lib/updates.ts'
import { PageHeader, Segmented } from '../../ui/controls.tsx'
import { Empty } from '../../ui/Empty.tsx'
import { Loading } from '../../ui/Loading.tsx'
import { useToast } from '../../ui/toast.tsx'
import { useDevice, useDownloads } from '../DeviceContext.tsx'
import { DownloadDetailsDialog } from '../components/downloadDetails.tsx'
import { isFinished } from '../components/downloads.tsx'
import { DownloadFileActions, FolderPanel, RootList, useRoots } from '../components/files.tsx'
import { PlayerDialog, subtitlesFor, type PlayTarget } from '../components/player.tsx'
import { useRun } from '../useRun.ts'

/**
 * Where Files is: the folder shown, in the page's history entry rather than its address, so a path on the device
 * never reaches the website's server or its logs. Back and Forward still step through the folders.
 */
export interface FilesLocation {
  path?: string
}

/** The device's download folder and the folders added on it: browse them, play what was downloaded, choose a folder. */
export function FilesPage() {
  const t = useT()
  const navigate = useNavigate()
  const location = useLocation()
  const { info, connection, settings } = useDevice()
  const { supported, roots, error, reload, setRoots } = useRoots()
  const path = (location.state as FilesLocation | null)?.path ?? roots?.roots.find(r => r.kind === 'downloads')?.path ?? roots?.roots[0]?.path ?? null
  const open = (next: string | null) => navigate(location.pathname, { state: next === null ? null : { path: next } satisfies FilesLocation })

  if (!info) return <Loading />
  if (!supported) {
    return (
      <>
        <PageHeader title={t('files.title')} />
        <Empty title={t('files.updateTitle')}
          text={t(connection.kind === 'local' ? 'files.updateLocal' : fileBrowserNotice(info?.version ?? '', BUILD.version), info?.version ?? '')} />
      </>
    )
  }
  const header = (actions: ReactNode) => <><header className="downloads-heading"><h1>{t('files.title')}</h1>{actions}</header>
    {roots && <div className="file-places"><Segmented appearance="quiet" label={t('files.roots')}
      value={roots.roots.find(r => path !== null && isWithin(path, r.path, separatorOf(r.path)))?.path ?? ''}
      onChange={open} options={roots.roots.map(root => ({ value: root.path, label: baseName(root.path, separatorOf(root.path)) }))} /></div>}</>

  return (
    <>
      {(!roots || path === null) && header(null)}
      {error && !roots && (
        <div role="alert" className="search-hint"><p>{error}</p><button className="infall-button" onClick={reload}>{t('common.retry')}</button></div>
      )}
      <div className="files-screen">{!roots
        ? !error && <Loading />
        : path === null
          ? <RootList roots={roots.roots} canAdd={roots.canAdd} onOpen={open} onChanged={setRoots} />
          : <Folder header={header} path={path} roots={roots.roots} downloadFolder={settings?.downloadFolder ?? null} onOpen={open} // Home is another place: the one open may be the drive that is gone.
            onHome={() => open(roots.roots.find(r => !isWithin(path, r.path, separatorOf(r.path)))?.path ?? null)} />}</div>
      {roots && path !== null && <details className="file-manage"><summary>{t('files.roots')}</summary><RootList roots={roots.roots} canAdd={roots.canAdd} onOpen={open} onChanged={setRoots} /></details>}
    </>
  )
}

function Folder({ path, roots, downloadFolder, onOpen, onHome, header }: {
  header: (actions: ReactNode) => ReactNode
  path: string
  roots: FolderRootDto[]
  downloadFolder: string | null
  onOpen: (path: string) => void
  onHome: () => void
}) {
  const t = useT()
  const run = useRun()
  const toast = useToast()
  const { connection } = useDevice()
  const [details, setDetails] = useState<number | null>(null)
  const [playing, setPlaying] = useState<PlayTarget | null>(null)
  const [opening, setOpening] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const play = async (entry: FolderEntryDto) => {
    const owner = entry.download
    if (!owner || owner.index === undefined) return
    setOpening(entry.name)
    const files = await run(() => connection.call('downloads.files', { id: owner.id }), 'files.playFailed')
    setOpening(null)
    const file = files?.find(f => f.index === owner.index)
    if (files && file) setPlaying({ downloadId: owner.id, file, subtitles: subtitlesFor(file, files) })
  }

  const useAsDownloadFolder = async (page: FolderPageDto) => {
    setSaving(true)
    const saved = await run(() => connection.call('settings.update', { downloadFolder: page.path }), 'files.useFailed')
    setSaving(false)
    if (saved) toast(t('files.downloadFolderSet', baseName(page.path, page.separator)), 'success')
  }

  const toolbar = (page: FolderPageDto) => {
    const isDownloadFolder = downloadFolder !== null && samePath(page.path, downloadFolder, page.separator)
    return isDownloadFolder
      ? <span className="file-destination">{t('files.newDownloadsHere')}</span>
      : (
        <button type="button" className="infall-button quiet file-use-folder" disabled={saving} onClick={() => void useAsDownloadFolder(page)}>
          {saving && <span className="loading loading-spinner loading-xs" />}{t('files.useAsDownloadFolder')}
        </button>
      )
  }

  return (
    <>
      <FolderPanel header={header} path={path} roots={roots} onOpen={onOpen} onHome={onHome} toolbar={toolbar}
        fileActions={entry => <DownloadFileActions entry={entry} playing={opening === entry.name} onPlay={e => void play(e)} onDetails={setDetails} />} />
      <Player target={playing} onClose={() => setPlaying(null)} />
      <DownloadDetailsDialog id={details} onClose={() => setDetails(null)} />
    </>
  )
}

/** The player for a file of a download; apart, so only it follows the downloads' progress each second. */
function Player({ target, onClose }: { target: PlayTarget | null; onClose: () => void }) {
  const download = useDownloads().find(d => d.id === target?.downloadId)
  return <PlayerDialog target={target} finished={download ? isFinished(download) : false} onClose={onClose} />
}
