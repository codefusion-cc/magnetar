import type { ReactNode } from 'react'
import { Star } from './Star.tsx'

/** A bare state in the page column, with optional actions. */
export function Empty({ title, text, children }: { title?: string; text: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-4 py-16 text-ink">
      <Star />
      <div className="min-w-0 max-w-full">
        {title && <h2 className="font-sans break-words text-[19px] font-semibold">{title}</h2>}
        <p className="mt-1 max-w-[46ch] break-words text-muted">{text}</p>
      </div>
      {children && <div className="flex max-w-full flex-col items-start gap-3">{children}</div>}
    </div>
  )
}
