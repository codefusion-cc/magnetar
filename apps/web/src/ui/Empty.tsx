import type { ReactNode } from 'react'
import { StateSky } from './sky/Sky.tsx'

/** A bare state in the page column, with optional actions. */
export function Empty({ title, text, children, appearance = 'bare', state = 'lit', role }: {
  title?: string; text: string; children?: ReactNode
  appearance?: 'bare' | 'download'; state?: 'lit' | 'far' | 'out'; role?: 'alert'
}) {
  if (appearance === 'download') return <section className="download-empty" role={role}>
    <div className="download-state-picture"><StateSky mode={state === 'out' ? 'off' : state === 'far' ? 'far' : 'on'} /></div>
    {title && <h1>{title}</h1>}<p>{text}</p>{children}
  </section>
  return (
    <div role={role} className="flex flex-col items-start gap-4 py-16 text-ink">
      <StateSky mode={state === 'out' ? 'off' : state === 'far' ? 'far' : 'on'} />
      <div className="min-w-0 max-w-full">
        {title && <h2 className="font-sans break-words text-[19px] font-semibold">{title}</h2>}
        <p className="mt-1 max-w-[46ch] break-words text-muted">{text}</p>
      </div>
      {children && <div className="flex max-w-full flex-col items-start gap-3">{children}</div>}
    </div>
  )
}
