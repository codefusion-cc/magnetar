import { DOWNLOAD_SORT_PREFIX, pageStorage } from './browserStorage.ts'

/** The orders the Downloads page offers. */
export const DOWNLOAD_SORTS = ['newest', 'oldest', 'name', 'size', 'progress'] as const
export type DownloadSort = (typeof DOWNLOAD_SORTS)[number]
export const DEFAULT_DOWNLOAD_SORT: DownloadSort = 'newest'

interface Sortable {
  name: string
  addedAt: string
  totalBytes: number
  progress: number
}

/** When it was added as a time, or null for none or one nobody can read. */
const addedTime = (d: Sortable): number | null => {
  const time = d.addedAt ? Date.parse(d.addedAt) : NaN
  return Number.isNaN(time) ? null : time
}

/** Bytes, or null while the size is not known (0 until a torrent's metadata arrives). */
const knownSize = (d: Sortable): number | null => (d.totalBytes > 0 ? d.totalBytes : null)

/** Compares by a number, `direction` 1 for ascending and -1 for descending, with a missing value after every present one. */
function byNumber<T>(value: (d: T) => number | null, direction: 1 | -1) {
  return (a: T, b: T): number => {
    const x = value(a)
    const y = value(b)
    if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1
    return (x - y) * direction
  }
}

/**
 * The downloads in the chosen order, as a new list. Ties and missing values keep the order they came in (the sort is
 * stable), so rows do not jump while progress changes: only Progress looks at it. Names compare without regard to case
 * or accents, and numbers inside them by value ("Episode 2" before "Episode 10").
 */
export function sortDownloads<T extends Sortable>(downloads: readonly T[], sort: DownloadSort, locale = 'en'): T[] {
  const names = new Intl.Collator(locale, { numeric: true, sensitivity: 'base' })
  const compare: Record<DownloadSort, (a: T, b: T) => number> = {
    newest: byNumber(addedTime, -1),
    oldest: byNumber(addedTime, 1),
    name: (a, b) => names.compare(a.name, b.name),
    size: byNumber(knownSize, -1),
    progress: byNumber(d => d.progress, -1),
  }
  return [...downloads].sort(compare[sort])
}

/** A stored choice, or the default when it is missing or no longer one of the orders. */
export function parseDownloadSort(value: unknown): DownloadSort {
  return DOWNLOAD_SORTS.find(s => s === value) ?? DEFAULT_DOWNLOAD_SORT
}

const keyFor = (device: string) => DOWNLOAD_SORT_PREFIX + device

/** The order this browser chose for `device`, or the default. Works without browser storage. */
export function readDownloadSort(device: string, storage = pageStorage()): DownloadSort {
  try {
    return parseDownloadSort(storage?.getItem(keyFor(device)))
  } catch {
    return DEFAULT_DOWNLOAD_SORT
  }
}

/** Remembers the choice for `device`; silently does nothing where browser storage is blocked. */
export function writeDownloadSort(device: string, sort: DownloadSort, storage = pageStorage()): void {
  try {
    storage?.setItem(keyFor(device), sort)
  } catch {
    // Blocked or full: the choice lasts until the page is reloaded.
  }
}
