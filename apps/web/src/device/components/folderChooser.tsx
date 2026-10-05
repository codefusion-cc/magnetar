import { CircleAlert } from 'lucide-react'
import { useEffect } from 'react'
import { formatBytes } from '@magnetar/protocol/bytes'
import { fileBrowserNotice } from '../../lib/buildVersion.ts'
import { usableOrDefault } from '../../lib/recentFolders.ts'
import { baseName, isWithin, separatorOf } from '../../lib/folderPaths.ts'
import { useT } from '../../lib/i18n.tsx'
import { BUILD } from '../../lib/updates.ts'
import { Loading } from '../../ui/Loading.tsx'
import { useDevice } from '../DeviceContext.tsx'
import { FolderPanel, RootList, useRoots } from './files.tsx'

/**
 * The folders of the device that can be browsed, and their subfolders, to choose one. `path` is the folder on screen,
 * null on the list of them; undefined until it is placed at `start` when that is inside one of them, else the list.
 */
export function Chooser({ start, path, onPath, recent, fallback }: {
  start: string
  path: string | null | undefined
  onPath: (path: string | null) => void
  /** When saving a download: the folders it went to before, to jump to, and the free space where the browser is. */
  recent?: string[]
  /** When saving a download: the default folder, which `start` gives way to if it can't be opened any more. */
  fallback?: string
}) {
  const t = useT()
  const { connection, info } = useDevice()
  const { supported, roots, error, setRoots } = useRoots()
  useEffect(() => {
    if (path !== undefined || !roots) return
    const inside = (folder: string) => folder !== '' && roots.roots.some(r => isWithin(folder, r.path, separatorOf(r.path)))
    if (fallback === undefined) {
      const wanted = start.trim()
      onPath(inside(wanted) ? wanted : null)
      return
    }
    let cancelled = false
    void usableOrDefault(start.trim(), fallback.trim(), folder =>
      inside(folder) ? connection.call('fs.browse', { path: folder, foldersOnly: true }).then(() => true, () => false) : Promise.resolve(false),
    ).then(folder => { if (!cancelled) onPath(inside(folder) ? folder : null) })
    return () => { cancelled = true }
  }, [roots, start, fallback, path, onPath, connection])

  if (!supported) {
    return (
      <p className="flex items-start gap-2 text-sm"><CircleAlert size={16} className="mt-0.5 shrink-0 text-warning" aria-hidden />
        {t(connection.kind === 'local' ? 'files.updateLocal' : fileBrowserNotice(info?.version ?? '', BUILD.version), info?.version ?? '')}</p>
    )
  }
  if (error && !roots) return <p role="alert" className="text-sm text-error">{error}</p>
  if (!roots || path === undefined) return <Loading />
  const inside = (folder: string) => roots.roots.find(r => isWithin(folder, r.path, separatorOf(r.path)))
  // Only folders the device lets this dashboard browse: a remembered one may be outside them now.
  const jumps = (recent ?? []).filter(inside)
  const free = path === null ? null : inside(path)?.freeBytes ?? null
  return (
    <>
      {recent && (jumps.length > 0 || free !== null) && (
        <div className="mb-3 flex flex-col gap-1.5">
          {free !== null && <p className="muted text-xs tabular-nums">{t('transfer.free', formatBytes(free))}</p>}
          {jumps.length > 0 && (
            <>
              <h4 className="text-xs font-semibold">{t('folderBrowser.recent')}</h4>
              <ul className="flex flex-wrap gap-1.5">
                {jumps.map(folder => (
                  <li key={folder} className="min-w-0 max-w-full">
                    <button type="button" className={`btn btn-xs max-w-full ${folder === path ? 'btn-primary btn-soft' : 'btn-outline'}`}
                      aria-pressed={folder === path} title={folder} onClick={() => onPath(folder)}>
                      <span className="truncate">{baseName(folder, separatorOf(folder)) || folder}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
      {path === null
        ? <RootList compact roots={roots.roots} canAdd={roots.canAdd} onOpen={onPath} onChanged={setRoots} />
        : <FolderPanel compact foldersOnly path={path} roots={roots.roots} onOpen={onPath} onHome={() => onPath(null)} />}
    </>
  )
}
