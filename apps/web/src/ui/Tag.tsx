import type { ReactNode } from 'react'

/** A word that marks a row's state ("Installed", "Unavailable"), in the state's colour inside a thin edge. */
export function Tag({ tone = 'muted', children }: { tone?: 'muted' | 'accent' | 'ok' | 'warn' | 'danger'; children: ReactNode }) {
  return <span className="infall-tag" data-tone={tone}>{children}</span>
}
