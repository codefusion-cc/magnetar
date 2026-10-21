import type { StarState } from '../lib/deviceStar.ts'

/** A CSS star for bare states and connection status. Its adjacent text names it. */
export function Star({ state = 'lit', breathe = false }: { state?: StarState; breathe?: boolean }) {
  return <span aria-hidden="true" data-state={state} className={`infall-star${breathe ? ' infall-star-breathe' : ''}`} />
}
