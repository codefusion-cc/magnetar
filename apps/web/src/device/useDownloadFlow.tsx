import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { DownloadFlow, askingWhere, type AlwaysOutcome } from '../lib/downloadFlow.ts'
import { errorMessage } from '../lib/errors.ts'
import { folderChoices, readRecentFolders, rememberFolder } from '../lib/recentFolders.ts'
import { FolderBrowser } from './components/folders.tsx'
import { useDevice, useDownloads } from './DeviceContext.tsx'

/**
 * The folders the folder browser offers for saving a download (where this device's downloads went, then what this
 * browser remembers), the default folder, how to remember one, and how to make one the download folder with asking off.
 */
export function useFolderChoices() {
  const { settings, deviceName, connection } = useDevice()
  const downloads = useDownloads()
  const [stored, setStored] = useState<string[]>([])
  useEffect(() => setStored(readRecentFolders(deviceName)), [deviceName])
  const defaultFolder = settings?.downloadFolder ?? ''
  const choices = useMemo(() => folderChoices(downloads, stored, defaultFolder), [downloads, stored, defaultFolder])
  const remember = useCallback((folder: string) => setStored(rememberFolder(deviceName, folder)), [deviceName])
  const alwaysHere = useCallback(async (folder: string) => {
    await connection.call('settings.update', { downloadFolder: folder, askDownloadFolder: false })
  }, [connection])
  return { choices, defaultFolder, remember, alwaysHere }
}

/**
 * Starting a download for the page that uses it: one click to the default folder, or through the folder browser
 * ("Download here") when the setting asks for it or `request(item, true)` is Download to…. The browser opens where
 * the last download was saved to; `browser` is its dialog, to render once.
 */
export function useDownloadFlow<T>({ start, started, failed, subject, describe = errorMessage }: {
  /** Adds the download, to `folder` or the default one. Rejects when the device refuses. */
  start: (item: T, folder?: string) => Promise<void>
  started?: (item: T, folder?: string, always?: AlwaysOutcome) => void
  /** A failure on the one-click path, which has no browser to show it in. */
  failed: (error: unknown) => void
  /** What the browser says is being saved. */
  subject?: (item: T) => { name: string; bytes: number | null }
  describe?: (error: unknown) => string
}): { request: (item: T, choose?: boolean) => void; busy: boolean; browser: ReactNode } {
  const { settings } = useDevice()
  const { choices, defaultFolder, remember, alwaysHere } = useFolderChoices()
  const latest = useRef({ start, started, failed, describe, subject, ask: false })
  latest.current = { start, started, failed, describe, subject, ask: askingWhere(settings).ask }
  const flow = useMemo(() => new DownloadFlow<T>({
    start: (item, folder) => latest.current.start(item, folder),
    ask: () => latest.current.ask,
    remember: alwaysHere,
    started: (item, folder, always) => {
      if (folder) remember(folder)
      latest.current.started?.(item, folder, always)
    },
    failed: error => latest.current.failed(error),
    describe: error => latest.current.describe(error),
  }), [remember, alwaysHere])
  const state = useSyncExternalStore(flow.subscribe, flow.getState)

  const browser = (
    <FolderBrowser open={state.choosing !== null} start={choices[0] ?? defaultFolder} onClose={() => flow.cancel()}
      onSelect={(folder, always) => void flow.confirm(folder, always)} save={{ canAlways: askingWhere(settings).canRemember, recent: choices, fallback: defaultFolder, busy: state.busy, error: state.error, subject: state.choosing === null ? undefined : subject?.(state.choosing) }} />
  )
  const request = useCallback((item: T, choose?: boolean) => void flow.request(item, choose), [flow])
  return { request, busy: state.busy, browser }
}
