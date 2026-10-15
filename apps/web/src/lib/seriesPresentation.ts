import type { SeriesEpisodeDto } from '@magnetar/protocol'
import type { Translate } from './i18n.tsx'

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
  const format = new Intl.DateTimeFormat(language === 'en' ? 'en-GB' : language, {
    weekday: 'long', ...(weekdayOnly ? {} : { day: 'numeric', month: 'long' }),
  })
  return format.formatToParts(date).map(part => part.type === 'weekday' ? t(`series.airDay.${date.getDay()}`) + (language === 'en' && !weekdayOnly ? ',' : '') : part.value).join('')
}
