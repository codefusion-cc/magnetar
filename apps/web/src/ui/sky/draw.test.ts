import type { SceneFrame } from '@codefusion-cc/scene'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { drawFan, drawHero, drawLanes, drawState, heroGeometry, heroLabels, skyColors, type Lane } from './draw.ts'

/** A 2D context that records every call and property write, so two paints can be compared exactly. */
function recorder() {
  const log: string[] = []
  const gradient = { addColorStop: (...args: unknown[]) => log.push(`stop ${JSON.stringify(args)}`) }
  const ctx = new Proxy({}, {
    get: (_, key) => (...args: unknown[]) => {
      log.push(`${String(key)} ${JSON.stringify(args)}`)
      return String(key).startsWith('create') ? gradient : undefined
    },
    set: (_, key, value) => { log.push(`${String(key)}=${typeof value === 'object' ? 'gradient' : String(value)}`); return true },
  }) as unknown as CanvasRenderingContext2D
  return { ctx, log }
}

const colors = Object.fromEntries(skyColors.map((name, i) => [name, `rgb(${i} ${i * 10} ${255 - i})`]))
function frame(overrides: Partial<SceneFrame> = {}) {
  const { ctx, log } = recorder()
  return { frame: { ctx, width: 900, height: 600, dpr: 2, t: 3.2, dt: 0, mode: 'dark', lively: false, offsetY: 0, colors, ...overrides } as SceneFrame, log }
}
const rows: Lane[] = [
  { x: 0, y: 40, w: 500, u: 0.64, st: 'Downloading' },
  { x: 0, y: 120, w: 500, u: 0.4, st: 'Paused' },
  { x: 0, y: 200, w: 500, u: 0, st: 'Error' },
  { x: 0, y: 280, w: 500, u: 1, st: 'Seeding' },
]

describe('sky scenes', () => {
  const scenes = {
    lanes: (f: SceneFrame) => drawLanes(f, rows),
    fan: (f: SceneFrame) => drawFan(f, [{ x: 200, y: 20, n: 22 }, { x: 200, y: 47, n: 0 }, { x: 200, y: 74, n: -1 }]),
    state: drawState('on'),
    stateOut: drawState('off'),
    hero: drawHero,
  }

  for (const [name, draw] of Object.entries(scenes)) {
    it(`${name} draws the same picture twice from the same frame, so still pictures and screenshots are stable`, () => {
      const a = frame(), b = frame()
      draw(a.frame)
      draw(b.frame)
      expect(a.log.length).toBeGreaterThan(10)
      expect(b.log).toEqual(a.log)
    })

    it(`${name} uses only the look's colours`, () => {
      const { frame: f, log } = frame()
      draw(f)
      const used = log.filter(line => /Style=/.test(line) && !line.endsWith('=gradient')).map(line => line.split('=')[1]!)
      for (const value of used) expect(value).toMatch(/^(rgb\(\d+ \d+ \d+\)|color-mix\(in srgb, .*\))$/)
    })
  }

  it('moves with the clock: a later moment draws a different lively picture', () => {
    const a = frame({ t: 1 }), b = frame({ t: 2 })
    drawLanes(a.frame, rows)
    drawLanes(b.frame, rows)
    expect(b.log).not.toEqual(a.log)
  })

  it('draws no lane at all for an empty list, only the star', () => {
    const empty = frame()
    drawLanes(empty.frame, [])
    expect(empty.log.filter(line => line.startsWith('arc'))).not.toHaveLength(0)
    expect(empty.log.some(line => line.startsWith('setLineDash'))).toBe(false)
    expect(empty.log.filter(line => line.startsWith('bezierCurveTo'))).toHaveLength(0)
  })

  it('a failed download is a broken dashed lane, a finished one a formed star with no lane into the star', () => {
    const failed = frame(), done = frame()
    drawLanes(failed.frame, [rows[2]!])
    drawLanes(done.frame, [rows[3]!])
    expect(failed.log).toContain('setLineDash [[3,7]]')
    expect(failed.log.some(line => line.startsWith('bezierCurveTo'))).toBe(false)
    expect(done.log.some(line => line.startsWith('bezierCurveTo'))).toBe(false)
  })

  it('on a phone each lane curves straight up into the star beside the summary', () => {
    const phone = frame({ width: 390 })
    drawLanes(phone.frame, [rows[0]!], { summary: 10 })
    expect(phone.log.some(line => line.startsWith('quadraticCurveTo'))).toBe(true)
    expect(phone.log.some(line => line.startsWith('bezierCurveTo'))).toBe(false)
  })
})

describe('the first page\'s source names', () => {
  it('every name lies inside the picture, whatever its size and the names\' widths', () => {
    fc.assert(fc.property(fc.integer({ min: 120, max: 1600 }), fc.integer({ min: 120, max: 900 }),
      fc.array(fc.tuple(fc.integer({ min: 1, max: 110 }), fc.integer({ min: 12, max: 28 })), { minLength: 6, maxLength: 6 }), (w, h, sizes) => {
        heroLabels(w, h, sizes).forEach(([x, y], k) => {
          const [lw, lh] = sizes[k]!
          expect(x).toBeGreaterThanOrEqual(0)
          expect(y).toBeGreaterThanOrEqual(0)
          expect(x + lw).toBeLessThanOrEqual(w + 0.5)
          expect(y + lh).toBeLessThanOrEqual(h + 0.5)
        })
      }))
  })

  it('a name that fits where its stream comes in sits right beside that point, not further in', () => {
    const w = 560, h = 430, size = [40, 20] as const
    const { at } = heroGeometry(w, h)
    const entries = Array.from({ length: 6 }, (_, k) => [Math.round(at(k, .02)[0] + 8), Math.round(at(k, .02)[1] - 20)])
    const fits = entries.map(([x, y]) => x! >= 6 && x! + size[0] <= w - 2 && y! >= 0 && y! + size[1] <= h - 2)
    expect(fits.some(Boolean)).toBe(true)
    heroLabels(w, h, entries.map(() => size)).forEach((spot, k) => { if (fits[k]) expect(spot).toEqual(entries[k]) })
  })
})
