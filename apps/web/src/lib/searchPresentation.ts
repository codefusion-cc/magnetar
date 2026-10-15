import type { SourceOutcomeDto } from '@magnetar/protocol'
import type { Translate } from './i18n.tsx'

export function searchCount(t: Translate, language: string, kind: 'results' | 'seeders', n: number): string {
  const plural = new Intl.PluralRules(language).select(n)
  return t(`search.${kind}.${plural === 'one' || plural === 'few' || plural === 'many' ? plural : 'other'}`, n)
}

/** Source totals describe all returned matches, even when deduplication leaves fewer result rows. */
export function searchSummary(t: Translate, language: string, { outcomes, total, sourceCount, searching, ran, query }: {
  outcomes: readonly SourceOutcomeDto[]; total: number; sourceCount: number; searching: boolean; ran: boolean; query: string
}): { line: string; allFailed: boolean } {
  const failed = outcomes.filter(o => o.status === 'failed')
  const empty = outcomes.filter(o => o.status === 'ok' && o.returned - o.filtered === 0)
  const found = outcomes.filter(o => o.status === 'ok' && o.returned - o.filtered > 0)
  const count = outcomes.reduce((n, o) => n + (o.status === 'ok' ? Math.max(0, o.returned - o.filtered) : 0), 0)
  const pending = Math.max(0, sourceCount - outcomes.length)
  const allFailed = ran && !searching && outcomes.length > 0 && failed.length === outcomes.length
  const names = (items: readonly SourceOutcomeDto[]) => new Intl.ListFormat(language, { style: 'long', type: 'conjunction' }).format(items.map(o => o.source))
  let line = !ran ? t(sourceCount === 6 ? 'search.beforeSix' : 'search.before', sourceCount) : searching ? t('search.soFar', searchCount(t, language, 'results', count || total), pending <= 6 ? t(`search.pending.${pending}`) : t('search.pending.other', pending))
    : allFailed ? t('search.noAnswer') : count === 0 ? t('search.nothingFor', query) : t('search.foundFrom', searchCount(t, language, 'results', count), found.length, sourceCount)
  if (!searching && !allFailed && ran) {
    if (empty.length && count > 0) line += ' ' + t(empty.length === 1 ? 'search.emptySource' : 'search.emptySources', names(empty)).replace(/\.$/, failed.length ? ',' : '.')
    if (failed.length) line += ' ' + t(failed.length === 1 ? 'search.failedSources' : 'search.failedSourcesMany', names(failed))
  }
  return { line, allFailed }
}
