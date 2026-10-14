import type { DownloadDto } from '@magnetar/protocol'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { ETA_WINDOW, MIN_SPAN, SPEED_WINDOW, recordSpeeds, steadySpeed, type SpeedHistory } from './steadySpeed.ts'

const MIB = 1024 * 1024
const GIB = 1024 * MIB

function download(over: Partial<DownloadDto> = {}): DownloadDto {
  return {
    id: 1, name: 'Ted.Lasso.S04', status: 'Downloading', progress: 9.2, totalBytes: 28.9 * GIB, downloadSpeed: 0,
    uploadSpeed: 0, peers: 4, source: 'tpb', savePath: '/d', addedAt: '2026-10-14T14:00:00Z', completedAt: null,
    error: null, seriesTaskId: null, uploadedBytes: 0, partialFiles: null, ...over,
  }
}

/** Pushes the speeds one second apart, from `start`, and returns the time of the last push. */
function push(history: SpeedHistory, speeds: readonly number[], start = 0, over: Partial<DownloadDto> = {}): number {
  speeds.forEach((speed, i) => recordSpeeds(history, [download({ downloadSpeed: speed, ...over })], start + i * 1000))
  return start + (speeds.length - 1) * 1000
}

describe('steadySpeed', () => {
  it('shows the reported speed as it is before the pushes cover enough time', () => {
    const history: SpeedHistory = new Map()
    push(history, [13.6 * MIB, 0.7 * MIB, 13.6 * MIB])
    // Two seconds covered, under MIN_SPAN: the latest stands.
    expect(steadySpeed(history, download({ downloadSpeed: 13.6 * MIB })).down).toBe(13.6 * MIB)
  })

  it('shows what the page has before any push, and nothing for a download it never saw', () => {
    expect(steadySpeed(new Map(), download({ downloadSpeed: 5 * MIB, uploadSpeed: MIB }))).toMatchObject({ down: 5 * MIB, up: MIB })
  })

  it('keeps a bursty torrent steady: speed and time left stay put while the reports swing twentyfold', () => {
    const history: SpeedHistory = new Map()
    const swings = Array.from({ length: 90 }, (_, i) => (i % 2 ? 0.7 : 13.6) * MIB)
    push(history, swings)
    const shown = steadySpeed(history, download({ downloadSpeed: swings.at(-1)! }))
    // The mean of the two is 7.15 MiB/s; one second either way moves a 15 s window by at most 1/15 of the swing.
    expect(shown.down).toBeGreaterThan(6.4 * MIB)
    expect(shown.down).toBeLessThan(7.9 * MIB)
    const remaining = 28.9 * GIB * (1 - 0.092)
    expect(shown.eta).toBeCloseTo(remaining / (7.15 * MIB), -2)
    const next = (recordSpeeds(history, [download({ downloadSpeed: 13.6 * MIB })], 90_000), steadySpeed(history, download()))
    expect(Math.abs(next.eta! - shown.eta!) / shown.eta!).toBeLessThan(0.03)
  })

  it('follows a real change: after a fall the shown speed reaches the new one within the speed window', () => {
    const history: SpeedHistory = new Map()
    const last = push(history, [...Array<number>(30).fill(10 * MIB), ...Array<number>(SPEED_WINDOW / 1000).fill(MIB)])
    expect(steadySpeed(history, download({ downloadSpeed: MIB })).down).toBe(MIB)
    expect(last).toBe(44_000)
  })

  it('weighs each report by the time it stands for, not by how many pushes said it', () => {
    const history: SpeedHistory = new Map()
    recordSpeeds(history, [download({ downloadSpeed: 0 })], 0)
    // Ten seconds at 10 MiB/s in one late push, then one second at 1 MiB/s.
    recordSpeeds(history, [download({ downloadSpeed: 10 * MIB })], 10_000)
    recordSpeeds(history, [download({ downloadSpeed: MIB })], 11_000)
    expect(steadySpeed(history, download()).down).toBeCloseTo((10 * 10 + 1) / 11 * MIB, 0)
  })

  it('starts afresh when the status changes, so a resumed download is not judged by its pause', () => {
    const history: SpeedHistory = new Map()
    push(history, Array<number>(20).fill(8 * MIB))
    push(history, [0, 0, 0], 20_000, { status: 'Seeding' })
    expect(steadySpeed(history, download({ status: 'Seeding' })).eta).toBeNull()
    recordSpeeds(history, [download({ downloadSpeed: 2 * MIB })], 23_000)
    expect(steadySpeed(history, download({ downloadSpeed: 2 * MIB }))).toMatchObject({ down: 2 * MIB })
  })

  it('has no time left when nothing moves or nothing is known of the size', () => {
    const history: SpeedHistory = new Map()
    push(history, Array<number>(10).fill(0))
    expect(steadySpeed(history, download()).eta).toBeNull()
    expect(steadySpeed(new Map(), download({ downloadSpeed: MIB, totalBytes: 0 })).eta).toBeNull()
    expect(steadySpeed(new Map(), download({ downloadSpeed: MIB, status: 'Seeding' })).eta).toBeNull()
  })

  it('forgets a download gone from the list or done moving, and keeps a minute of history however long it runs', () => {
    const history: SpeedHistory = new Map()
    push(history, Array<number>(10_000).fill(MIB))
    expect(history.get(1)!.samples.length).toBeLessThanOrEqual(ETA_WINDOW / 1000 + 1)
    recordSpeeds(history, [], 10_000_000)
    expect(history.size).toBe(0)
    push(history, Array<number>(5).fill(MIB))
    recordSpeeds(history, [download({ status: 'Completed' }), download({ id: 2, status: 'Paused' })], 6_000)
    expect(history.size).toBe(0)
  })

  it('counts a push restated in the same instant once', () => {
    const history: SpeedHistory = new Map()
    push(history, Array<number>(10).fill(MIB))
    recordSpeeds(history, [download({ downloadSpeed: 9 * MIB })], 9_000)
    // The last second now says 9 MiB/s: nine seconds of 1 and one of 9 (the first sample opens the window).
    expect(steadySpeed(history, download()).down).toBeCloseTo((8 * 1 + 9) / 9 * MIB, 0)
  })

  it('switches from the latest report to the average exactly when MIN_SPAN is covered', () => {
    const history: SpeedHistory = new Map()
    recordSpeeds(history, [download({ downloadSpeed: 0 })], 0)
    recordSpeeds(history, [download({ downloadSpeed: 4 * MIB })], MIN_SPAN - 1)
    expect(steadySpeed(history, download()).down).toBe(4 * MIB)
    recordSpeeds(history, [download({ downloadSpeed: 0 })], MIN_SPAN)
    expect(steadySpeed(history, download()).down).toBeCloseTo(4 * MIB * (MIN_SPAN - 1) / MIN_SPAN, 0)
  })

  it('never shows a speed outside what the pushes in its window said', () => {
    fc.assert(fc.property(
      fc.array(fc.record({ gap: fc.integer({ min: 1, max: 20_000 }), speed: fc.integer({ min: 0, max: 200 * MIB }) }), { minLength: 1, maxLength: 120 }),
      pushes => {
        const history: SpeedHistory = new Map()
        let at = 0
        for (const { gap, speed } of pushes) recordSpeeds(history, [download({ downloadSpeed: speed })], (at += gap))
        const shown = steadySpeed(history, download()).down
        const speeds = pushes.map(p => p.speed)
        return shown >= Math.min(...speeds) - 1e-6 && shown <= Math.max(...speeds) + 1e-6
      },
    ))
  })
})
