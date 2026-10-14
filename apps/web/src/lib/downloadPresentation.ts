import type { DownloadDto } from '@magnetar/protocol'
import type { Translate } from './i18n.tsx'

/** Decimal units used by the download screens, with the dashboard's decimal separator. */
export function downloadBytes(bytes: number, language: string): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  let value = Math.max(0, Number.isFinite(bytes) ? bytes : 0)
  let unit = 0
  while (value >= 1000 && unit < units.length - 1) { value /= 1000; unit++ }
  return `${new Intl.NumberFormat(language, { maximumFractionDigits: 1 }).format(value)} ${units[unit]}`
}

export function downloadSummary(t: Translate, language: string, name: string, count: number, speed: number): string {
  const form = count === 0 ? 'zero' : new Intl.PluralRules(language).select(count)
  const key = ['zero', 'one', 'few'].includes(form) ? form : 'other'
  return t(`downloads.summary.${key}`, name, count, `${downloadBytes(speed, language)}/s`)
}

export function downloadEta(t: Translate, seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60))
  if (minutes < 60) return t(minutes === 1 ? 'downloads.minuteLeft' : 'downloads.minutesLeft', minutes)
  return t('downloads.hoursLeft', Math.floor(minutes / 60), minutes % 60)
}

/** Keep a row that finishes in the current Active view until the person changes views. */
export function retainFinished(previous: ReadonlySet<number>, downloads: readonly DownloadDto[]): Set<number> {
  return new Set(downloads.filter(d => previous.has(d.id) || (d.status !== 'Completed' && d.status !== 'Seeding')).map(d => d.id))
}

/** Calendar words for the dates shown in download facts. */
export function downloadDay(t: Translate, language: string, iso: string, withTime = false, now = new Date()): string {
  const date = new Date(iso)
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  const sameDay = (other: Date) => date.toDateString() === other.toDateString()
  const day = sameDay(now) ? t('downloads.today') : sameDay(yesterday) ? t('downloads.yesterday') : date.toLocaleDateString(language)
  return withTime ? `${day}, ${date.toLocaleTimeString(language, { hour: '2-digit', minute: '2-digit', hour12: false })}` : day
}
