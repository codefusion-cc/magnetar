import type { DownloadDto } from '@magnetar/protocol'
import { useMemo, useRef } from 'react'

/**
 * The speeds the Downloads page shows, steadied. The app reports each download's speed as librqbit measures it, over
 * the last five seconds, and a torrent with few peers swings between megabytes and kilobytes a second from one push to
 * the next; a time left taken from that swings between minutes and hours. The page keeps what the pushes said and
 * shows averages over time: the speeds over `SPEED_WINDOW`, the time left from the download speed over `ETA_WINDOW`.
 * A reported speed describes the seconds before its push, so each one stands for the time since the push before.
 */
export const SPEED_WINDOW = 15_000
export const ETA_WINDOW = 60_000
const MOVING: ReadonlySet<DownloadDto['status']> = new Set(['FetchingMetadata', 'Downloading', 'Seeding'])

/** Until the pushes cover this much time, the latest reported speed stands as it is. */
export const MIN_SPAN = 3_000

interface Sample {
  at: number
  down: number
  up: number
}

interface Track {
  status: DownloadDto['status']
  samples: Sample[]
}

/** What the pushes said of each download, per id; one per page, kept across pushes. */
export type SpeedHistory = Map<number, Track>

export interface SteadySpeed {
  down: number
  up: number
  /** Seconds left, from the download speed over `ETA_WINDOW`; null when it is not downloading or not moving. */
  eta: number | null
}

/**
 * Adds a push at `now`. A download whose status changed starts afresh (a resumed one is not judged by its pause), one
 * gone from the list or no longer moving is forgotten, and what is older than `ETA_WINDOW` is dropped but for the
 * sample that opens it.
 */
export function recordSpeeds(history: SpeedHistory, downloads: readonly DownloadDto[], now: number): void {
  const seen = new Set<number>()
  for (const d of downloads) {
    // Only what moves has speeds worth a history; the rest shows what it reports (none).
    if (!MOVING.has(d.status)) continue
    seen.add(d.id)
    let track = history.get(d.id)
    if (!track || track.status !== d.status) {
      track = { status: d.status, samples: [] }
      history.set(d.id, track)
    }
    const { samples } = track
    const last = samples.at(-1)
    // A push in the same instant (the page drawn twice) restates the last one.
    if (last && now <= last.at) Object.assign(last, { down: d.downloadSpeed, up: d.uploadSpeed })
    else samples.push({ at: now, down: d.downloadSpeed, up: d.uploadSpeed })
    let drop = 0
    while (drop + 1 < samples.length && samples[drop + 1]!.at <= now - ETA_WINDOW) drop++
    if (drop > 0) samples.splice(0, drop)
  }
  for (const id of history.keys()) if (!seen.has(id)) history.delete(id)
}

/** The time-weighted average of `pick` over the `window` before the latest sample, or the latest value while too short. */
function average(samples: readonly Sample[], window: number, pick: (sample: Sample) => number): number {
  const latest = samples.at(-1)
  if (!latest) return 0
  const start = latest.at - window
  let sum = 0
  let covered = 0
  for (let i = 1; i < samples.length; i++) {
    const from = Math.max(samples[i - 1]!.at, start)
    const span = samples[i]!.at - from
    if (span <= 0) continue
    sum += pick(samples[i]!) * span
    covered += span
  }
  return covered < MIN_SPAN ? pick(latest) : sum / covered
}

/** The speeds to show for `d`, from what `history` holds of it (its latest reported values when it holds nothing). */
export function steadySpeed(history: SpeedHistory, d: DownloadDto): SteadySpeed {
  const samples = history.get(d.id)?.samples ?? [{ at: 0, down: d.downloadSpeed, up: d.uploadSpeed }]
  const etaRate = average(samples, ETA_WINDOW, s => s.down)
  const remaining = d.totalBytes * (1 - d.progress / 100)
  return {
    down: average(samples, SPEED_WINDOW, s => s.down),
    up: average(samples, SPEED_WINDOW, s => s.up),
    eta: d.status === 'Downloading' && etaRate > 0 && d.totalBytes > 0 ? remaining / etaRate : null,
  }
}

/** Each download's steadied speeds, by id, recorded on every change of `downloads` (one push). */
export function useSteadySpeeds(downloads: readonly DownloadDto[]): ReadonlyMap<number, SteadySpeed> {
  const history = useRef<SpeedHistory>(new Map())
  return useMemo(() => {
    recordSpeeds(history.current, downloads, Date.now())
    return new Map(downloads.map(d => [d.id, steadySpeed(history.current, d)]))
  }, [downloads])
}
