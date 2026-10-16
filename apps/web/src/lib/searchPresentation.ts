import type { SourceOutcomeDto } from '@magnetar/protocol'
import { formatters, pluralMessage, type Translate } from './i18n.tsx'

export function searchCount(t: Translate, language: string, kind: 'results' | 'seeders', n: number): string {
  return pluralMessage(t, language, `search.${kind}`, n, n)
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
  const names = (items: readonly SourceOutcomeDto[]) => formatters(language).list(items.map(o => o.source), { style: 'long', type: 'conjunction' })
  let line = !ran ? t(sourceCount === 6 ? 'search.beforeSix' : sourceCount === 1 ? 'search.beforeOne' : 'search.before', sourceCount) : searching ? t('search.soFar', searchCount(t, language, 'results', count || total), pending <= 6 ? t(`search.pending.${pending}`) : t('search.pending.other', pending))
    : allFailed ? t('search.noAnswer') : count === 0 ? t('search.nothingFor', query) : t(sourceCount === 1 ? 'search.foundFromOne' : 'search.foundFrom', searchCount(t, language, 'results', count), found.length, sourceCount)
  if (!searching && !allFailed && ran) {
    if (empty.length && count > 0 && failed.length) {
      line += ' ' + t(`search.emptyAndFailed.${empty.length === 1 ? 'one' : 'other'}.${failed.length === 1 ? 'one' : 'other'}`, names(empty), names(failed))
    } else {
      if (empty.length && count > 0) line += ' ' + t(empty.length === 1 ? 'search.emptySource' : 'search.emptySources', names(empty))
      if (failed.length) line += ' ' + t(failed.length === 1 ? 'search.failedSources' : 'search.failedSourcesMany', names(failed))
    }
  }
  return { line, allFailed }
}

export function outcomeTitle(t: Translate, outcome: SourceOutcomeDto | undefined): string | undefined {
  if (!outcome) return undefined
  if (outcome.status === 'failed') return t('search.outcomeFailedDetail', outcome.error ?? '')
  if (outcome.filtered) return t('search.outcomeFiltered', outcome.returned - outcome.filtered, outcome.returned, outcome.filtered)
  return t('search.outcomeOk', outcome.returned)
}

export function outcomeCount(t: Translate, outcome: SourceOutcomeDto | undefined, searching: boolean): string | number {
  if (!outcome) return searching ? t('search.asking') : ''
  if (outcome.status === 'failed') return t('search.outcomeFailed')
  return outcome.returned - outcome.filtered
}
