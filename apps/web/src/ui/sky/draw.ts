import type { SceneDraw, SceneFrame } from '@codefusion-cc/scene'

export const skyColors = ['core', 'white', 'edge', 'field', 'glow', 'far', 'far-glow', 'void', 'cold', 'red', 'warm', 'hot', 'ice', 'held'].map(k => `--mg-sky-${k}`)
type Palette = Record<string, string>
/** `quake`: the lit star sending rings out, while the computer updates. */
export type StarMode = 'on' | 'wake' | 'off' | 'far' | 'quake'
export interface Lane { x: number; y: number; w: number; u: number; st: string }
export interface Source { x: number; y: number; n: number }
const TAU = Math.PI * 2
const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x))
const lerp = (a: number, b: number, u: number) => a + (b - a) * u
const alpha = (color: string, a: number) => `color-mix(in srgb, ${color} ${clamp(a) * 100}%, transparent)`
const color = (p: Palette, name: string) => p[`--mg-sky-${name}`]!
function heat(p: Palette, u: number) {
  const stops: [number, string][] = [[0, 'cold'], [.25, 'red'], [.5, 'warm'], [.75, 'hot'], [.92, 'core'], [1, 'ice']]
  u = clamp(u)
  const i = stops.findIndex(([at]) => at >= u)
  if (i <= 0) return color(p, 'cold')
  const [a, ca] = stops[i - 1]!, [b, cb] = stops[i]!
  return `color-mix(in srgb, ${color(p, ca)} ${(1 - (u - a) / (b - a)) * 100}%, ${color(p, cb)})`
}
function glow(c: CanvasRenderingContext2D, x: number, y: number, r: number, col: string, a: number) {
  const g = c.createRadialGradient(x, y, 0, x, y, r)
  g.addColorStop(0, alpha(col, a)); g.addColorStop(.3, alpha(col, a * .38)); g.addColorStop(1, alpha(col, 0))
  c.fillStyle = g; c.fillRect(x - r, y - r, r * 2, r * 2)
}
const dot = (c: CanvasRenderingContext2D, x: number, y: number, r: number) => { c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill() }
type Vec = [number, number, number]
const cross = (a: Vec, b: Vec): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
// The field's axis leans left and towards the viewer; U and V span the plane its loops turn in.
const AXIS: Vec = [Math.sin(-.42) * Math.cos(.5), -Math.cos(-.42) * Math.cos(.5), Math.sin(.5)]
const NORMAL = cross(AXIS, [0, 0, 1]), U = NORMAL.map(v => v / Math.hypot(...NORMAL)) as Vec, V = cross(AXIS, U)

/**
 * One loop of the star's field, r = L sin²θ, turned `a` round the axis: its points around the star's centre, and how near
 * the viewer it lies (`depth`, -1 to 1). The pictures' star and the brand mark draw the same loops.
 */
export function fieldLoop(L: number, a: number, steps = 28) {
  const D = U.map((v, i) => v * Math.cos(a) + V[i]! * Math.sin(a)) as Vec
  const points = Array.from({ length: steps + 1 }, (_, k) => {
    const th = k / steps * Math.PI, r = L * Math.sin(th) ** 2, z = r * Math.cos(th), q = r * Math.sin(th)
    return [AXIS[0] * z + D[0] * q, AXIS[1] * z + D[1] * q] as const
  })
  return { points, depth: D[2] }
}
function star(c: CanvasRenderingContext2D, p: Palette, x: number, y: number, R: number, t: number, mode: StarMode = 'on') {
  const off = mode === 'off', spin = t * TAU / 7
  if (mode === 'far') { glow(c, x, y, R * 6, color(p, 'far-glow'), .5); c.fillStyle = color(p, 'far'); dot(c, x, y, R * .6); return }
  c.save(); c.globalCompositeOperation = 'lighter'
  const wake = mode === 'wake' ? .45 + .4 * Math.sin(t * 2.2) ** 2 : 1
  if (!off) { glow(c, x, y, R * 9 * (1 + .08 * Math.sin(spin)), color(p, 'glow'), .3 * wake); glow(c, x, y, R * 4.2, color(p, 'edge'), .6 * wake) }
  if (mode === 'quake') for (let k = 0; k < 3; k++) {
    const ph = (t / 2.4 + k / 3) % 1
    c.strokeStyle = alpha(color(p, 'field'), (1 - ph) * .6); c.lineWidth = 1.5; c.beginPath(); c.arc(x, y, R * (1.3 + ph * 8), 0, TAU); c.stroke()
  }
  for (const [L, n] of [[R * 4.2, 6], [R * 7.5, 8]] as const) for (let j = 0; j < n; j++) {
    const { points, depth } = fieldLoop(L, j * TAU / n + spin)
    c.strokeStyle = alpha(color(p, 'field'), (off ? .06 + .1 * (depth + 1) / 2 : .08 + .22 * (depth + 1) / 2) * wake)
    c.lineWidth = 1; c.beginPath()
    points.forEach(([px, py], k) => { if (k) c.lineTo(x + px, y + py); else c.moveTo(x + px, y + py) })
    c.stroke()
  }
  c.restore()
  c.beginPath(); c.arc(x, y, R, 0, TAU)
  if (off) { c.fillStyle = color(p, 'void'); c.fill(); c.strokeStyle = alpha(color(p, 'edge'), .5); c.lineWidth = 1.2; c.stroke() }
  else {
    const g = c.createRadialGradient(x - R * .25, y - R * .25, 0, x, y, R)
    g.addColorStop(0, color(p, 'white')); g.addColorStop(.7, color(p, 'core')); g.addColorStop(1, color(p, 'edge'))
    c.fillStyle = g; c.globalAlpha = mode === 'wake' ? .5 + wake * .5 : 1; c.fill(); c.globalAlpha = 1
  }
}
function formed(c: CanvasRenderingContext2D, p: Palette, x: number, y: number) {
  const r = 2.6
  glow(c, x, y, r * 5, color(p, 'ice'), .55)
  c.strokeStyle = alpha(color(p, 'ice'), .55); c.lineWidth = 1; c.beginPath()
  c.moveTo(x - r * 3.4, y); c.lineTo(x + r * 3.4, y); c.moveTo(x, y - r * 3.4); c.lineTo(x, y + r * 3.4); c.stroke()
  c.fillStyle = color(p, 'white'); dot(c, x, y, r)
}

export function drawLanes({ ctx: c, width: w, height: h, t, colors: p }: SceneFrame, rows: readonly Lane[], { one = false, top = 0, bottom = h, summary = 0 } = {}) {
  const phone = w < 620, R = phone ? 10 : one ? 11 : 20
  const sx = phone ? w - 34 : one ? w - 150 : w - 196
  const sy = phone ? summary + 40 : one ? rows[0]?.y ?? 80 : clamp((Math.max(top, 0) + Math.min(bottom, h)) / 2, 120, Math.max(120, h - 120))
  for (const r of rows) {
    const live = ['Downloading', 'FetchingMetadata', 'Queued'].includes(r.st), xe = r.x + r.w, xh = r.x + r.w * clamp(r.u), y = r.y
    if (r.st === 'Seeding' || r.st === 'Completed') { formed(c, p, r.x + 7, y); continue }
    if (r.st === 'Error') {
      c.setLineDash([3, 7]); c.strokeStyle = alpha(color(p, 'far'), .5); c.lineWidth = 1; c.beginPath(); c.moveTo(r.x + 16, y); c.lineTo(xe, y); c.stroke(); c.setLineDash([])
      glow(c, r.x + 6, y, 12, color(p, 'far-glow'), .5); c.fillStyle = color(p, 'far'); dot(c, r.x + 6, y, 2.4); continue
    }
    c.strokeStyle = alpha(color(p, 'field'), .2); c.lineWidth = 1; c.beginPath(); c.moveTo(xh, y); c.lineTo(xe, y)
    if (phone) c.quadraticCurveTo(sx, y, sx, sy + R)
    else c.bezierCurveTo(lerp(xe, sx, .65), y, lerp(xe, sx, .45), sy, sx, sy)
    c.stroke()
    const col = live ? heat(p, r.u) : color(p, 'held')
    if (xh - r.x > 2) {
      const g = c.createLinearGradient(r.x, 0, xh, 0)
      if (live) { g.addColorStop(0, alpha(heat(p, 0), .3)); g.addColorStop(.5, alpha(heat(p, r.u * .5), .75)); g.addColorStop(1, col) }
      else { g.addColorStop(0, alpha(col, .25)); g.addColorStop(1, alpha(col, .7)) }
      c.lineCap = 'round'; c.strokeStyle = g; c.globalAlpha = .2; c.lineWidth = 9; c.beginPath(); c.moveTo(r.x, y); c.lineTo(xh, y); c.stroke()
      c.globalAlpha = 1; c.lineWidth = 3; c.beginPath(); c.moveTo(r.x + 1, y); c.lineTo(xh, y); c.stroke(); c.lineCap = 'butt'
    }
    if (live) {
      for (let k = 0; k < 3; k++) { const s = (t * (.1 + r.u * .12) + k / 3 + r.u) % 1; c.fillStyle = alpha(color(p, 'core'), .75 * s); dot(c, r.x + (xh - r.x) * s, y, 1.3) }
      c.save(); c.globalCompositeOperation = 'lighter'; glow(c, xh, y, 18, col, .95); c.restore(); c.fillStyle = color(p, 'white'); dot(c, xh, y, 3)
    } else { c.fillStyle = color(p, 'void'); c.strokeStyle = col; c.lineWidth = 1.6; dot(c, xh, y, 5); c.stroke() }
  }
  if (sy > -R * 9) star(c, p, sx, sy, R, t)
}

export function drawFan({ ctx: c, width: w, height: h, t, colors: p }: SceneFrame, rows: readonly Source[], aim?: readonly [number, number]) {
  // With nothing to aim at, the star keeps its outer rings (7.5 R) inside the picture.
  const R = w < 520 ? 9 : 14, sx = aim?.[0] ?? w - R * 8, sy = aim?.[1] ?? h / 2
  for (const r of rows) {
    const at = (s: number) => {
      const u = 1 - s
      return [u ** 3 * r.x + 3 * u * u * s * lerp(r.x, sx, .55) + 3 * u * s * s * lerp(r.x, sx, .6) + s ** 3 * sx, u ** 3 * r.y + 3 * u * u * s * r.y + 3 * u * s * s * sy + s ** 3 * sy] as const
    }
    const end = r.n === -1 ? .42 : 1
    let prev = at(0)
    for (let i = 1; i <= 40 * end; i++) {
      const s = i / 40, q = at(s)
      c.strokeStyle = r.n > 0 ? alpha(heat(p, .2 + s * .7), .25 + .5 * s) : alpha(color(p, 'field'), r.n === -1 ? .3 * (1 - s / end) : .13)
      c.lineWidth = r.n > 0 ? 1.4 : 1; c.beginPath(); c.moveTo(...prev); c.lineTo(...q); c.stroke(); prev = q
    }
    for (let j = 0; j < Math.min(r.n, 12); j++) {
      const s = (t * .05 + j / Math.min(r.n, 12)) % 1, q = at(s), col = heat(p, .2 + s * .7)
      c.save(); c.globalCompositeOperation = 'lighter'; glow(c, ...q, 7, col, .6); c.restore(); c.fillStyle = col; dot(c, ...q, 1.6)
    }
    if (r.n === -2) { const s = (t * .22 + r.y * .013) % 1, q = at(s); glow(c, ...q, 9, color(p, 'field'), .5 * (1 - s)) }
  }
  star(c, p, sx, sy, R, t)
}
export const drawState = (mode: StarMode = 'on'): SceneDraw => ({ ctx, width, height, t, colors }) => {
  const small = height < 110
  star(ctx, colors, small ? width / 2 : Math.min(width / 2, 150), height / 2, small ? 7 : mode === 'far' ? 9 : 17, t, mode)
}

/** The first page's six streams: `at(k, s)` is stream k at s, from 0 where it enters to 1 at the star. */
export function heroGeometry(w: number, h: number) {
  const phone = w < 520, sx = w * (phone ? .5 : .56), sy = h * .5, R = phone ? 13 : 21, M = Math.max(w, h) * (phone ? .62 : .6)
  const at = (k: number, s: number) => {
    const r = R + (M - R) * (1 - s) ** 1.6, a = k * TAU / 6 + .35 + s * 2.7
    return [sx + Math.cos(a) * r, sy + Math.sin(a) * r * .56] as const
  }
  return { sx, sy, R, at }
}

/**
 * Where each stream's name goes (its top-left corner): beside the stream where it enters the picture, or further in
 * where that is outside, and never past the picture's edges.
 */
export function heroLabels(w: number, h: number, sizes: readonly (readonly [number, number])[]): [number, number][] {
  const { at } = heroGeometry(w, h)
  return sizes.map(([lw, lh], k) => {
    let s = .02, q = at(k, s)
    while (s < .5 && (q[0] < 6 || q[0] + 8 + lw > w - 2 || q[1] - 20 < 0 || q[1] - 20 + lh > h - 2)) { s += .02; q = at(k, s) }
    return [Math.round(Math.max(0, Math.min(w - lw, q[0] + 8))), Math.round(Math.max(0, Math.min(h - lh, q[1] - 20)))]
  })
}

export const drawHero: SceneDraw = ({ ctx: c, width: w, height: h, t, colors: p }) => {
  let seed = 7
  const random = () => (seed = seed * 16807 % 2147483647) / 2147483647
  for (let i = 0; i < 150; i++) {
    const a = random(), b = random(), s = random() * 1.1 + .4, d = random()
    c.fillStyle = alpha(color(p, 'core'), .16 + d * .5); c.fillRect(a * w, b * h, s, s)
  }
  const { sx, sy, R, at } = heroGeometry(w, h)
  c.lineWidth = 1.2
  for (let k = 0; k < 6; k++) {
    let prev = at(k, 0)
    for (let i = 1; i <= 64; i++) {
      const s = i / 64, q = at(k, s)
      c.strokeStyle = alpha(heat(p, .12 + s * .88), .2 + .45 * s * s); c.beginPath(); c.moveTo(...prev); c.lineTo(...q); c.stroke(); prev = q
    }
    for (let j = 0; j < 5; j++) {
      const s = ((t * .045 + j / 5 + k * .137) % 1) ** .8, q = at(k, s), col = heat(p, s)
      c.save(); c.globalCompositeOperation = 'lighter'; glow(c, ...q, 5 + s * 7, col, .7); c.restore(); c.fillStyle = col; dot(c, ...q, 1 + s * 1.4)
    }
  }
  star(c, p, sx, sy, R, t)
}
