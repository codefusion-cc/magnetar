import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { SceneCanvas, useScene } from '@codefusion-cc/scene/react'
import type { SceneDraw } from '@codefusion-cc/scene'
import { drawFan, drawHero, drawLanes, drawState, skyColors, type Lane, type StarMode } from './draw.ts'

const options = { colors: skyColors }

const noDraw: SceneDraw = () => {}

export function StateSky({ mode = 'on', className = '' }: { mode?: StarMode; className?: string }) {
  const draw = useMemo(() => drawState(mode), [mode])
  return <SceneCanvas className={`sky state-sky ${className}`} draw={draw} options={options} aria-hidden="true" />
}
export function HeroSky() {
  return <SceneCanvas className="sky hero-sky" draw={drawHero} options={options} aria-hidden="true" />
}

/** Only the visible rows are measured, even when thousands of rows have been loaded. */
export function LanesSky({ children, one = false }: { children: ReactNode; one?: boolean }) {
  // The pinned scene reads the list's scroll offset; it mounts once the list element exists, so it keeps one identity.
  const [element, setElement] = useState<HTMLDivElement | null>(null)
  const host = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null)
  const hostRef = useCallback((node: HTMLDivElement | null) => { host.current = node; if (node) setElement(node) }, [])
  const draw = useCallback<SceneDraw>(frame => {
    const root = host.current, cv = canvas.current
    if (!root || !cv) return
    const b = cv.getBoundingClientRect()
    const list = root.querySelector('.download-list')
    const items = list?.children
    const lanes: Lane[] = []
    const measure = (element: Element) => {
      const lane = element.querySelector<HTMLElement>('.download-lane')
      if (!lane) return
      const r = lane.getBoundingClientRect(), y = r.top - b.top + r.height / 2
      if (y < -24 || y > frame.height + 24 || !r.width) return
      lanes.push({ x: r.left - b.left, y, w: r.width, st: lane.dataset.status!, u: Number(lane.dataset.progress) / 100 })
    }
    if (items) {
      const hostTop = b.top - frame.offsetY
      let lo = 0, hi = items.length
      while (lo < hi) {
        const mid = (lo + hi) >>> 1
        if (items[mid]!.getBoundingClientRect().bottom - hostTop < frame.offsetY - 24) lo = mid + 1
        else hi = mid
      }
      for (let i = lo; i < items.length; i++) {
        const item = items[i]!
        if (item.getBoundingClientRect().top - hostTop > frame.offsetY + frame.height + 24) break
        measure(item)
      }
    } else measure(root)
    const extent = (list ?? root).getBoundingClientRect()
    const summary = root.querySelector('.downloads-summary,.download-one-heading')?.getBoundingClientRect().top ?? b.top
    drawLanes(frame, lanes, { one, top: extent.top - b.top, bottom: extent.bottom - b.top, summary: summary - b.top })
  }, [one])
  const scene = useScene(canvas, element ? draw : noDraw, { ...options, pin: 'viewport', element: element ?? undefined })
  const repaint = useCallback(() => scene.current?.repaint(), [scene])
  // The list re-renders on every progress push; one repaint after it commits keeps the lanes on their rows.
  useLayoutEffect(repaint)
  useEffect(() => {
    document.addEventListener('scroll', repaint, { capture: true, passive: true })
    return () => document.removeEventListener('scroll', repaint, true)
  }, [repaint])
  return <div className="sky-lanes" ref={hostRef} onPointerDown={() => scene.current?.touch()}>
    <div className="sky-pin"><canvas ref={canvas} className="sky lanes-sky" aria-hidden="true" /></div>
    <div className="sky-content">{children}</div>
  </div>
}

export function FanSky({ revision }: { revision: unknown }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const draw = useCallback<SceneDraw>(frame => {
    const cv = canvas.current, host = cv?.parentElement
    if (!host || !cv) return
    const b = cv.getBoundingClientRect()
    const rows = [...host.querySelectorAll<HTMLElement>('li')].map(li => {
      const r = li.getBoundingClientRect()
      return { x: r.right - b.left + 12, y: r.top - b.top + r.height / 2, n: Number(li.dataset.count) }
    })
    const btn = host.closest('main')?.querySelector('.search-results li .infall-button')?.getBoundingClientRect()
    const aim = frame.width >= 520 && btn && btn.top - b.top < frame.height - 10 ? [btn.left - b.left - 30, btn.top - b.top + btn.height / 2] as const : undefined
    drawFan(frame, rows, aim)
  }, [])
  const scene = useScene(canvas, draw, options)
  useLayoutEffect(() => { scene.current?.repaint() }, [scene, revision])
  return <canvas ref={canvas} className="sky search-fan" aria-hidden="true" />
}
