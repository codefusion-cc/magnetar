import { useEffect } from 'react'
import { fileBrowserNotice } from '../../lib/buildVersion.ts'
import { chipLabels, exceedsFreeSpace, usableOrDefault } from '../../lib/recentFolders.ts'
import { isWithin, separatorOf } from '../../lib/folderPaths.ts'
import { useFormatBytes, useT } from '../../lib/i18n.tsx'
import { BUILD } from '../../lib/updates.ts'
import { Loading } from '../../ui/Loading.tsx'
import { useDevice } from '../DeviceContext.tsx'
import { FolderPanel, RootList, rootLabel, useRoots } from './files.tsx'

/**
 * The folders of the device that can be browsed, and their subfolders, to choose one. `path` is the folder on screen,
 * null on the list of them; undefined until it is placed at `start` when that is inside one of them, else the list.
 */
export function Chooser({ start, path, onPath, recent, fallback, needBytes, onReady }: {
  start: string
  path: string | null | undefined
  onPath: (path: string | null) => void
  /** When saving a download: the folders it went to before, to jump to, and the free space where the browser is. */
  recent?: string[]
  /** When saving a download: the default folder, which `start` gives way to if it can't be opened any more. */
  fallback?: string
  /** The size of what is being saved, when known, to warn when the folder's disk is too small for it. */
  needBytes?: number | null
  /** The folder on screen has loaded. */
  onReady?: () => void
}) {
  const t = useT()
  const formatBytes = useFormatBytes()
  const { connection, info } = useDevice()
  const { supported, roots, error, setRoots } = useRoots()
  const rootOf = (folder: string) => roots?.roots.find(r => isWithin(folder, r.path, separatorOf(r.path)))
  useEffect(() => {
    if (path !== undefined || !roots) return
    const inside = (folder: string) => folder !== '' && rootOf(folder) !== undefined
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
      <p className="setting-warn">
        {t(connection.kind === 'local' ? 'files.updateLocal' : fileBrowserNotice(info?.version ?? '', BUILD.version), info?.version ?? '')}</p>
    )
  }
  if (error && !roots) return <p role="alert" className="setting-alert">{error}</p>
  if (!roots || path === undefined) return <Loading />
  // Only folders the device lets this dashboard browse: a remembered one may be outside them now.
  const jumps = (recent ?? []).filter(rootOf)
  const labels = chipLabels(jumps)
  const here = path === null ? undefined : rootOf(path)
  const tooSmall = recent !== undefined && exceedsFreeSpace(needBytes, here?.freeBytes)
  return (
    <>
      {jumps.length > 0 && (
        <div className="mb-3 grid gap-1.5">
          <h4 className="fine">{t('folderBrowser.recent')}</h4>
          <ul className="setting-days">
            {jumps.map((folder, i) => (
              <li key={folder}>
                <button type="button"
                  aria-pressed={folder === path} title={folder} onClick={() => onPath(folder)}>
                  {labels[i]}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {tooSmall && (
        <p className="setting-warn mb-3">
          {t('folderBrowser.notEnough', formatBytes(needBytes!), formatBytes(here!.freeBytes!))}
        </p>
      )}
      {path === null
        ? <RootList roots={roots.roots} canAdd={roots.canAdd} onOpen={onPath} onChanged={setRoots} />
        : <FolderPanel compact foldersOnly path={path} roots={roots.roots} onOpen={onPath} onHome={() => onPath(null)} onReady={onReady}
          status={recent === undefined ? undefined : root => root?.freeBytes != null && (
            <span className={`flex flex-wrap gap-x-3 text-[15px] tabular-nums ${tooSmall ? 'text-warn' : 'text-muted'}`}>
              <span>{rootLabel(root, separatorOf(root.path), t)}</span><span>{t('transfer.free', formatBytes(root.freeBytes))}</span>
            </span>
          )} />}
    </>
  )
}
