import type { DownloadDto } from '@magnetar/protocol'
import { formatRate } from '@magnetar/protocol/bytes'
import { formatters, pluralMessage, type Translate } from './i18n.tsx'
import { calendarDistance } from './seriesPresentation.ts'
import { isFinished } from './downloadViews.ts'

export function downloadSummary(t: Translate, language: string, name: string, count: number, speed: number): string {
  return pluralMessage(t, language, 'downloads.summary', count, name, count, formatRate(speed, 1, { decimal: true, locale: language }))
}

export function noPeersError(error: string | null): boolean {
  return error === 'No peers after 3 minutes' || error === 'No peers found' || error?.startsWith('No peers found — ') === true
}

/** Only rows that turned finished while Active was open survive its filter. */
export function retainFinished(retained: ReadonlySet<number>, previous: readonly DownloadDto[], downloads: readonly DownloadDto[]): Set<number> {
  const active = new Set(previous.filter(d => !isFinished(d)).map(d => d.id))
  return new Set(downloads.filter(d => isFinished(d) && (retained.has(d.id) || active.has(d.id))).map(d => d.id))
}

/** Calendar words for the dates shown in download facts and file listings. */
export function downloadDay(language: string, iso: string, withTime = false, now = new Date(), style: 'facts' | 'file' = 'facts'): string {
  const date = new Date(iso)
  const distance = calendarDistance(iso, now.getTime())
  if (Number.isNaN(date.getTime())) return '—'
  const f = formatters(language)
  const word = distance === 0 || distance === -1 ? calendarWord(language, distance) : f.date(iso, { year: 'numeric', month: 'numeric', day: 'numeric' })
  return withTime ? `${word}${style === 'file' ? ' ' : ', '}${f.date(iso, { hour: '2-digit', minute: '2-digit', hour12: false })}` : word
}

const calendarFormats = new Map<string, Intl.RelativeTimeFormat>()
export function calendarWord(language: string, distance: number): string {
  let format = calendarFormats.get(`${language}:${distance === 0}`)
  if (!format) { format = new Intl.RelativeTimeFormat(language, { numeric: 'auto', style: distance === 0 ? 'narrow' : 'long' }); calendarFormats.set(`${language}:${distance === 0}`, format) }
  return format.format(distance, 'day')
}
