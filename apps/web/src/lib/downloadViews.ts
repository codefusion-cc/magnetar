import type { DownloadStatus } from '@magnetar/protocol'

/** The three views of the Downloads page; the first is the default. */
export const DOWNLOAD_VIEWS = ['active', 'finished', 'all'] as const
export type DownloadView = (typeof DOWNLOAD_VIEWS)[number]
export const DEFAULT_DOWNLOAD_VIEW: DownloadView = 'active'

/** A running transfer, excluding uploads from finished downloads. */
export const isRunning = (d: { status: DownloadStatus }): boolean => d.status === 'Downloading'

/** A download whose work can be paused, including seeding. */
export const isActive = (d: { status: DownloadStatus }): boolean => isRunning(d) || d.status === 'FetchingMetadata' || d.status === 'Queued' || d.status === 'Seeding'

/** Everything asked for is on disk, whether it still seeds or has stopped. */
export const isFinished = (d: { status: DownloadStatus }): boolean => d.status === 'Completed' || d.status === 'Seeding'

/** Everything not finished is Active, a failed one included: it needs attention. */
export function inView(status: DownloadStatus, view: DownloadView): boolean {
  return view === 'all' || isFinished({ status }) === (view === 'finished')
}
