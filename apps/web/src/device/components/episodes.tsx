import type { SeriesEpisodeDto } from '@magnetar/protocol'
import type { CSSProperties } from 'react'
import { useLanguage, useT } from '../../lib/i18n.tsx'
import { calendarDistance, episodeArc } from '../../lib/seriesPresentation.ts'
import { Star } from '../../ui/Star.tsx'

export function SeasonOrbit({ episodes, total, label, progress = 0 }: { episodes: readonly SeriesEpisodeDto[]; total: number; label: string; progress?: number }) {
  // The device sends a bounded window. Draw that window rather than inventing states for absent episodes.
  const drawn = episodes.slice(0, 200)
  const active = Math.max(0, drawn.findIndex(e => e.state === 'downloading'))
  const angle = (active + progress / 100) * 2 * Math.PI / Math.max(1, drawn.length) - Math.PI / 2
  return <svg className={`season-orbit ${!total ? 'none' : ''}`} viewBox="0 0 80 80" role="img" aria-label={label}>
    <g transform="rotate(-18 40 40) translate(0 14) scale(1 .65)">
      {drawn.length ? drawn.map((e, i) => <path key={e.number} data-episode={e.number} className={`seg ${e.state === 'have' ? 'got' : e.state === 'downloading' ? 'now' : ''}`} d={episodeArc(i, drawn.length)} />) : <circle className="seg" cx="40" cy="40" r="30" />}
      {drawn.some(e => e.state === 'downloading') && <circle className="body" cx={40 + 30 * Math.cos(angle)} cy={40 + 30 * Math.sin(angle)} r="4.5" />}
    </g><circle className="sun" cx="40" cy="40" r="4" />
  </svg>
}

export function EpisodeApproach({ episodes, now = Date.now() }: { episodes: readonly SeriesEpisodeDto[]; now?: number }) {
  const language = useLanguage()
  const t = useT()
  // Group same-day airings so labels cannot overlap. Full episode names remain accessible.
  const days = new Map<number, SeriesEpisodeDto[]>()
  for (const e of episodes) {
    if (!e.airstamp) continue
    const day = calendarDistance(e.airstamp, now)
    days.set(day, [...(days.get(day) ?? []), e])
  }
  return <div className={`episode-approach ${days.size ? '' : 'none'}`}>
    {[...days].map(([day, group], i) => <span key={day} className={`approaching-episode ${day === 0 ? 'now' : ''}`}
      style={{ '--d': Math.max(day, 1.1) / 14, '--i': i } as CSSProperties}
      aria-label={group.map(e => `${e.number}: ${new Date(e.airstamp!).toLocaleDateString(language)}`).join(', ')}>
      {day !== 0 && <small>{`${new Date(group[0]!.airstamp!).toLocaleDateString(language, { weekday: 'short' })} ${new Date(group[0]!.airstamp!).getDate()}`}{group.length > 1 ? ` (${group.length})` : ''}</small>}
    </span>)}
    <span className="approach-today"><Star /><small>{t('downloads.today')}</small></span>
  </div>
}
