import type { DownloadStatus } from '@magnetar/protocol'

/** The three views of the Downloads page; the first is the default. */
export const DOWNLOAD_VIEWS = ['active', 'finished', 'all'] as const
export type DownloadView = (typeof DOWNLOAD_VIEWS)[number]
export const DEFAULT_DOWNLOAD_VIEW: DownloadView = 'active'

/** Statuses in Finished: everything asked for is on disk, whether it still seeds or has stopped. */
const FINISHED: readonly DownloadStatus[] = ['Seeding', 'Completed']

/** Whether a download with this status is in `view`. Everything not finished is Active, a failed one included: it needs attention. */
export function inView(status: DownloadStatus, view: DownloadView): boolean {
  return view === 'all' || FINISHED.includes(status) === (view === 'finished')
}

/** The view a download is listed in, apart from All. */
export const viewOf = (status: DownloadStatus): Exclude<DownloadView, 'all'> => (FINISHED.includes(status) ? 'finished' : 'active')

/** How many downloads each view lists. */
export function countViews(downloads: readonly { status: DownloadStatus }[]): Record<DownloadView, number> {
  const counts = { active: 0, finished: 0, all: downloads.length }
  for (const d of downloads) counts[viewOf(d.status)]++
  return counts
}

/** The view to open for a link to one download: the one that lists it, or the default when it is not known (yet). */
export function viewForDownload(downloads: readonly { id: number; status: DownloadStatus }[], id: number): DownloadView {
  const found = downloads.find(d => d.id === id)
  return found ? viewOf(found.status) : DEFAULT_DOWNLOAD_VIEW
}
