import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { DownloadFlow } from '../lib/downloadFlow.ts'
import { errorMessage } from '../lib/errors.ts'
import { folderChoices, readRecentFolders, rememberFolder } from '../lib/recentFolders.ts'
import { FolderBrowser } from './components/folders.tsx'
import { useDevice, useDownloads } from './DeviceContext.tsx'

/**
 * Starting a download for the page that uses it: one click to the default folder, or through the folder browser
 * ("Download here") when the setting asks for it or `request(item, true)` is Download to…. The browser opens where
 * the last download was saved to; `browser` is its dialog, to render once.
 */
export function useDownloadFlow<T>({ start, started, failed, subject, describe = errorMessage }: {
  /** Adds the download, to `folder` or the default one. Rejects when the device refuses. */
  start: (item: T, folder?: string) => Promise<void>
  started?: (item: T, folder?: string) => void
  /** A failure on the one-click path, which has no browser to show it in. */
  failed: (error: unknown) => void
  /** What the browser says is being saved. */
  subject?: (item: T) => { name: string; bytes: number | null }
  describe?: (error: unknown) => string
}): { request: (item: T, choose?: boolean) => void; busy: boolean; browser: ReactNode } {
  const { settings, deviceName } = useDevice()
  const downloads = useDownloads()
  const [stored, setStored] = useState<string[]>([])
  useEffect(() => setStored(readRecentFolders(deviceName)), [deviceName])
  const latest = useRef({ start, started, failed, describe, subject, ask: false })
  latest.current = { start, started, failed, describe, subject, ask: settings?.askDownloadFolder === true }
  const flow = useMemo(() => new DownloadFlow<T>({
    start: (item, folder) => latest.current.start(item, folder),
    ask: () => latest.current.ask,
    started: (item, folder) => {
      if (folder) setStored(rememberFolder(deviceName, folder))
      latest.current.started?.(item, folder)
    },
    failed: error => latest.current.failed(error),
    describe: error => latest.current.describe(error),
  }), [deviceName])
  const state = useSyncExternalStore(flow.subscribe, flow.getState)

  const defaultFolder = settings?.downloadFolder ?? ''
  const choices = useMemo(() => folderChoices(downloads, stored, defaultFolder), [downloads, stored, defaultFolder])
  const browser = (
    <FolderBrowser open={state.choosing !== null} start={choices[0] ?? defaultFolder} onClose={() => flow.cancel()}
      onSelect={folder => void flow.confirm(folder)} save={{ recent: choices, fallback: defaultFolder, busy: state.busy, error: state.error, subject: state.choosing === null ? undefined : subject?.(state.choosing) }} />
  )
  const request = useCallback((item: T, choose?: boolean) => void flow.request(item, choose), [flow])
  return { request, busy: state.busy, browser }
}
