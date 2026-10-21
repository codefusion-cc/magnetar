import type { ReactNode, Ref } from 'react'
import { useT } from '../lib/i18n.tsx'
import type { StarMode } from './sky/draw.ts'
import { StateSky } from './sky/Sky.tsx'

const skies: Record<'lit' | 'far' | 'out' | 'updating', StarMode> = { lit: 'on', far: 'far', out: 'off', updating: 'quake' }

/**
 * A state in the page column, with optional actions. `page` is the whole page's state (the star's picture, a heading,
 * what to do), `bare` one part of a page. Its heading is an h2 under the page's own; `heading="h1"` where the state is
 * the page. `onRetry` adds Try again. `updating` is the lit star sending out rings.
 */
export function Empty({ title, text, children, appearance = 'bare', state = 'lit', role, heading = 'h2', onRetry, className = '', ref, tabIndex }: {
  title?: ReactNode; text: ReactNode; children?: ReactNode
  appearance?: 'bare' | 'page'; state?: keyof typeof skies; role?: 'alert' | 'status'; heading?: 'h1' | 'h2'
  onRetry?: () => void; className?: string; ref?: Ref<HTMLElement>; tabIndex?: number
}) {
  const t = useT()
  const Heading = heading
  const retry = onRetry && <div className="infall-acts"><button type="button" className="infall-button" onClick={() => onRetry()}>{t('common.retry')}</button></div>
  if (appearance === 'page') return <section ref={ref} tabIndex={tabIndex} className={`download-empty ${className}`} role={role}>
    <div className="download-state-picture"><StateSky mode={skies[state]} /></div>
    {title && <Heading>{title}</Heading>}<p className="download-lead">{text}</p>{children}{retry}
  </section>
  return (
    <div role={role} className="flex flex-col items-start gap-4 py-16 text-ink">
      <StateSky mode={skies[state]} />
      <div className="min-w-0 max-w-full">
        {title && <h2 className="font-sans break-words text-[19px] font-semibold">{title}</h2>}
        <p className="mt-1 max-w-[46ch] break-words text-muted">{text}</p>
      </div>
      {(children || retry) && <div className="flex max-w-full flex-col items-start gap-3">{children}{retry}</div>}
    </div>
  )
}
