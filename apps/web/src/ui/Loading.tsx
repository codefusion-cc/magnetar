import { useT } from '../lib/i18n.tsx'
import { Star } from './Star.tsx'

/** A slowly breathing star while a page (`screen`) or a section loads. */
export function Loading({ screen = false }: { screen?: boolean }) {
  const t = useT()
  return (
    <div role="status" aria-live="polite" className={screen ? 'grid min-h-dvh place-items-center bg-page text-ink' : 'flex justify-center py-20 text-ink'}>
      <div className="flex items-center gap-5">
        <Star breathe />
        <span className="text-sm text-muted">{t('common.loading')}</span>
      </div>
    </div>
  )
}
