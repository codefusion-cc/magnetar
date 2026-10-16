import type { ReactNode } from 'react'
import type { StarState } from '../lib/deviceStar.ts'
import { Star } from '../ui/Star.tsx'

/** One computer as the website lists it: its star, its name, one line on how it is, and what to do with it. */
export function ComputerRow({ name, star, line, children, as: Row = 'li' }: {
  name: string; star: StarState; line: string; children?: ReactNode; as?: 'li' | 'div'
}) {
  return (
    <Row className="computer">
      <span className="computer-star"><Star state={star} /></span>
      <div className="computer-body"><h2>{name}</h2><p>{line}</p></div>
      {children && <div className="computer-acts">{children}</div>}
    </Row>
  )
}
