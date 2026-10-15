import type { DownloadStatus, SeriesEpisodeDto, SeriesTaskDto } from '@magnetar/protocol'
import { formatters, type Translate } from './i18n.tsx'
import { resolutionLabel } from './quality.ts'

/** Calendar distance in the viewer's zone; DST days still count as one day. */
export function calendarDistance(iso: string, now: number): number {
  const date = new Date(iso), today = new Date(now)
  const day = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000
  return day(date) - day(today)
}

/** Only dated episodes still on their way, in air order, within the approach line's two weeks. */
export function upcomingEpisodes(episodes: readonly SeriesEpisodeDto[], now: number, horizon = 14): SeriesEpisodeDto[] {
  return episodes.filter(e => e.airstamp && (e.state === 'expected' || e.state === 'downloading') && calendarDistance(e.airstamp, now) >= 0 && calendarDistance(e.airstamp, now) <= horizon)
    .sort((a, b) => Date.parse(a.airstamp!) - Date.parse(b.airstamp!) || a.number - b.number)
}

/** SVG elliptical orbit; a single episode is almost a full circle, never a zero-length arc. */
export function episodeArc(index: number, total: number): string {
  const angle = 360 / Math.max(1, total)
  const gap = Math.min(2.5, angle / 5)
  const point = (a: number) => [40 + 30 * Math.cos((a - 90) * Math.PI / 180), 40 + 30 * Math.sin((a - 90) * Math.PI / 180)].map(v => v.toFixed(3)).join(' ')
  return `M${point(index * angle + gap)}A30 30 0 ${angle - gap * 2 > 180 ? 1 : 0} 1 ${point((index + 1) * angle - gap)}`
}

/** Weekdays take the grammatical form used after “expected” in each catalog. */
export function episodeAirDate(iso: string, language: string, t: Translate, weekdayOnly = false): string {
  const date = new Date(iso)
  const weekday = t(`series.airDay.${date.getDay()}`)
  if (weekdayOnly) return weekday
  const numbers = formatters(language).numberFormat()
  const month = airFormat(language).formatToParts(date).find(part => part.type === 'month')!.value
  return t('series.airDate', weekday, numbers.format(date.getDate()), month)
}

const airFormats = new Map<string, Intl.DateTimeFormat>()
function airFormat(language: string, short = false): Intl.DateTimeFormat {
  const key = `${language}:${short}`
  let format = airFormats.get(key)
  if (!format) {
    format = new Intl.DateTimeFormat(language, short ? { weekday: 'short' } : { day: 'numeric', month: 'long' })
    airFormats.set(key, format)
  }
  return format
}

/** Approach labels use a standalone weekday abbreviation and the catalog's date layout. */
export function episodeApproachDate(iso: string, language: string, t: Translate): string {
  const date = new Date(iso)
  return t('series.approachDate', airFormat(language, true).format(date), formatters(language).number(date.getDate()))
}

const EPISODE_ACTIVITY: Record<DownloadStatus, string> = {
  Queued: 'series.episodePreparing', FetchingMetadata: 'series.episodePreparing',
  Downloading: 'series.downloadingEpisode', Paused: 'series.episodePaused', Error: 'series.episodeFailed',
  Completed: 'series.episodeReady', Seeding: 'series.episodeReady',
}

export function seriesLine(t: Translate, { task, got, total, active, activeStatus, next, expected, date, checked }: {
  task: Pick<SeriesTaskDto, 'enabled' | 'finished' | 'nextEpisode'>; got: number; total: number
  active?: SeriesEpisodeDto; activeStatus?: DownloadStatus; next?: SeriesEpisodeDto; expected?: SeriesEpisodeDto; date: string | null; checked: string
}): string {
  if (!task.enabled && !task.finished) return t('series.pausedHint')
  if (task.finished) return t(got === total && total > 0 ? 'series.allHere' : 'series.ruleFinished') + ' ' + checked + '.'
  if (active) return t(activeStatus ? EPISODE_ACTIVITY[activeStatus] : 'series.downloadingEpisode', active.number) + (next && date ? ' ' + t('series.expectedEpisode', next.number, date) : '')
  if (next && date) return t('series.expectedEpisode', next.number, date)
  return t(expected?.airstamp ? 'series.waitingReleaseEpisode' : 'series.waitingEpisode', task.nextEpisode)
}

export function seriesRule(t: Translate, task: Pick<SeriesTaskDto, 'season' | 'resolution' | 'minSeeders' | 'preferWords'>, got: number, total: number): string {
  const quality = [resolutionLabel(task.resolution) || t('series.anyQuality'), task.minSeeders > 1 && t('watch.seedersAtLeast', task.minSeeders), task.preferWords && t('watch.prefers', task.preferWords)].filter(Boolean).join(', ')
  if (total === 1) return (task.season === null ? '' : t('series.seasonN', task.season) + ', ') + t('series.orbitFactsOne', got, quality)
  if (task.season === null) return t('series.orbitFactsNoSeason', got, total, quality)
  return t('series.orbitFacts', task.season, got, total, quality)
}
