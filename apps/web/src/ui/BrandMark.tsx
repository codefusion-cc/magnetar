import { useId } from 'react'
import { fieldLoop } from './sky/draw.ts'

// Six loops of the field the pictures' star wears, at rest; nearer loops are brighter.
const loops = Array.from({ length: 6 }, (_, j) => {
  const { points, depth } = fieldLoop(11.8, j * Math.PI / 3 + .3, 32)
  return { d: points.map(([x, y], k) => `${k ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`).join(''), opacity: +(.35 + .55 * (depth + 1) / 2).toFixed(2) }
})

/**
 * Magnetar's mark: the star everything falls into, inside the loops of its magnetic field, as the star on Downloads and
 * Search is drawn. In the look's heat, so it follows light and dark. The same shape is the app icon
 * (apps/client/assets/makeicon.swift) and public/icon.svg.
 */
export function BrandMark({ size = 26 }: { size?: number }) {
  // useId's colons or guillemets are not safe inside url(#…).
  const id = 'mark' + useId().replace(/[^\w-]/g, '')
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="-13 -13 26 26" className="shrink-0 overflow-visible">
      <defs>
        <radialGradient id={`${id}glow`}>
          <stop offset="0" style={{ stopColor: 'light-dark(color-mix(in srgb, var(--mg-h1) 35%, transparent), color-mix(in srgb, var(--mg-h1) 55%, transparent))' }} />
          <stop offset="1" style={{ stopColor: 'color-mix(in srgb, var(--mg-h1) 0%, transparent)' }} />
        </radialGradient>
        <radialGradient id={`${id}core`} fx=".3" fy=".3">
          <stop offset="0" style={{ stopColor: 'var(--mg-h2)' }} />
          <stop offset=".7" style={{ stopColor: 'var(--mg-core)' }} />
          <stop offset="1" style={{ stopColor: 'light-dark(var(--mg-core), var(--cf-accent-2))' }} />
        </radialGradient>
      </defs>
      <circle r="9" fill={`url(#${id}glow)`} />
      <g fill="none" stroke="var(--cf-accent-2)" strokeWidth=".9" strokeLinecap="round">
        {loops.map(({ d, opacity }) => <path key={d} d={d} strokeOpacity={opacity} />)}
      </g>
      <circle r="3.5" fill={`url(#${id}core)`} />
    </svg>
  )
}
