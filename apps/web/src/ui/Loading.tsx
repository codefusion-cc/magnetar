import { useT } from '../lib/i18n.tsx'
import { Star } from './Star.tsx'

/** A slowly breathing star while a page (`screen`) or a section loads. */
export function Loading({ screen = false, text, rows = 0, skeletonOnly = false }: {
  screen?: boolean; text?: string; rows?: number; skeletonOnly?: boolean
}) {
  const t = useT()
  if (rows > 0 || skeletonOnly) return <>
    {skeletonOnly ? <span role="status" className="sr-only">{text ?? t('common.loading')}</span>
      : <div className="downloads-wait" role="status"><Star breathe /><p>{text ?? t('common.loading')}</p></div>}
    <ul className="download-skeleton" aria-hidden="true">{Array.from({ length: rows }, (_, i) => <li key={i}><i /><i /></li>)}</ul>
  </>
  return (
    <div role="status" aria-live="polite" className={screen ? 'grid min-h-dvh place-items-center bg-page text-ink' : 'flex justify-center py-20 text-ink'}>
      <div className="flex items-center gap-5">
        <Star breathe />
        <span className="text-sm text-muted">{text ?? t('common.loading')}</span>
      </div>
    </div>
  )
}
