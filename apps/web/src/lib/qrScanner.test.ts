import QRCode from 'qrcode'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { decodeQr, startScanner, type Frame, type Scanner, type ScannerDeps, type ScannerProblem } from './qrScanner.ts'

/** A camera stream whose tracks the test can end. */
function fakeStream() {
  const listeners: Array<() => void> = []
  const track = { stop: vi.fn(), addEventListener: (_: string, run: () => void) => listeners.push(run) }
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream
  return { stream, track, end: () => listeners.forEach(run => run()) }
}

function fakeVideo() {
  return { srcObject: null as unknown, muted: false, setAttribute: vi.fn(), play: vi.fn(async () => {}) } as unknown as HTMLVideoElement
}

const FRAME: Frame = { data: new Uint8ClampedArray(4), width: 1, height: 1 }

/** Scanner dependencies on a clock the test moves; `reads` is what each frame decodes to, in order. */
function setup(reads: Array<string | null | Error>) {
  const camera = fakeStream()
  /** Every camera opened, the first being `camera`. */
  const cameras = [camera]
  let opened = 0
  let now = 0
  let hidden = false
  let watcher: (() => void) | null = null
  let pending: (() => void) | null = null
  const queue = [...reads]
  const deps: ScannerDeps = {
    getUserMedia: vi.fn(async () => (cameras[opened++] ??= fakeStream()).stream),
    hidden: () => hidden,
    onVisibility: run => {
      watcher = run
      return () => { watcher = null }
    },
    grab: () => FRAME,
    decode: async () => {
      const next = queue.shift() ?? null
      if (next instanceof Error) throw next
      return next
    },
    later: run => {
      pending = run
      return () => { pending = null }
    },
    now: () => now,
  }
  /** Runs the next scheduled frame after `ms`, and lets its decode finish. */
  const frame = async (ms = 120) => {
    now += ms
    const run = pending
    pending = null
    run?.()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  }
  /** The page goes to the background or comes back, and what follows settles. */
  const show = async (visible: boolean) => {
    hidden = !visible
    watcher?.()
    for (let i = 0; i < 6; i++) await Promise.resolve()
  }
  return { deps, camera, cameras, frame, show, scheduled: () => pending !== null, watched: () => watcher !== null }
}

async function start(reads: Array<string | null | Error>) {
  const env = setup(reads)
  const texts: string[] = []
  const problems: ScannerProblem[] = []
  const video = fakeVideo()
  const result = await startScanner(video, text => texts.push(text), problem => problems.push(problem), env.deps)
  if ('problem' in result) throw new Error(result.problem)
  await Promise.resolve()
  return { ...env, texts, problems, video, scanner: result as Scanner }
}

describe('opening the camera', () => {
  test.each([
    ['NotAllowedError', 'denied'],
    ['SecurityError', 'denied'],
    ['NotFoundError', 'no-camera'],
    ['OverconstrainedError', 'no-camera'],
    ['NotReadableError', 'busy'],
    ['AbortError', 'busy'],
  ] as const)('%s is %s', async (name, problem) => {
    const env = setup([])
    env.deps.getUserMedia = async () => { throw new DOMException('no', name) }
    await expect(startScanner(fakeVideo(), () => {}, () => {}, env.deps)).resolves.toEqual({ problem })
    expect(env.scheduled()).toBe(false)
  })

  test('asks for the back camera, without sound, and shows it in the video', async () => {
    const { deps, video, camera } = await start([])
    expect(deps.getUserMedia).toHaveBeenCalledWith({ audio: false, video: { facingMode: { ideal: 'environment' } } })
    expect(video.srcObject).toBe(camera.stream)
    expect(video.muted).toBe(true)
    expect(video.setAttribute).toHaveBeenCalledWith('playsinline', '')
  })

  test('a camera API that is missing is a problem, not a throw', async () => {
    const env = setup([])
    env.deps.getUserMedia = () => { throw new TypeError('mediaDevices is undefined') }
    // The real dependency throws synchronously when there is no navigator.mediaDevices; the scanner awaits it.
    await expect(startScanner(fakeVideo(), () => {}, () => {}, env.deps)).resolves.toEqual({ problem: 'busy' })
  })
})

describe('reading codes', () => {
  test('reports a code once, and again only after a while if it is still in view', async () => {
    const { texts, frame } = await start(['CODE A', 'CODE A', 'CODE A', 'CODE A', 'CODE B'])
    expect(texts).toEqual(['CODE A'])
    await frame(120)
    await frame(120)
    expect(texts).toEqual(['CODE A'])
    await frame(2_000)
    expect(texts).toEqual(['CODE A', 'CODE A'])
    await frame(120)
    expect(texts).toEqual(['CODE A', 'CODE A', 'CODE B'])
  })

  test('frames with no code report nothing, and a frame that cannot be read is skipped', async () => {
    const { texts, frame } = await start([null, new Error('canvas lost'), null, 'CODE C'])
    await frame()
    await frame()
    expect(texts).toEqual([])
    await frame()
    expect(texts).toEqual(['CODE C'])
  })
})

describe('stopping', () => {
  test('releases the camera, empties the video and reads no more frames', async () => {
    const { scanner, camera, video, frame, texts, scheduled } = await start(['CODE A', 'CODE B'])
    scanner.stop()
    expect(camera.track.stop).toHaveBeenCalledTimes(1)
    expect(video.srcObject).toBeNull()
    expect(scheduled()).toBe(false)
    await frame(5_000)
    expect(texts).toEqual(['CODE A'])
  })

  test('a camera taken away mid-scan is reported and released, once', async () => {
    const { camera, problems, video, scheduled } = await start([])
    camera.end()
    camera.end()
    expect(problems).toEqual(['busy'])
    expect(camera.track.stop).toHaveBeenCalledTimes(1)
    expect(video.srcObject).toBeNull()
    expect(scheduled()).toBe(false)
  })

  test('a camera that ends after stop is not a problem', async () => {
    const { scanner, camera, problems } = await start([])
    scanner.stop()
    camera.end()
    expect(problems).toEqual([])
  })
})

describe('a page nobody is looking at', () => {
  test('lets the camera go while hidden and opens it again when it is back', async () => {
    const { camera, cameras, video, show, frame, texts, scheduled, deps } = await start(['CODE A', 'CODE B', 'CODE C'])
    await show(false)
    expect(camera.track.stop).toHaveBeenCalledTimes(1)
    expect(video.srcObject).toBeNull()
    expect(scheduled()).toBe(false)
    await frame(5_000)
    expect(texts).toEqual(['CODE A'])

    await show(true)
    expect(deps.getUserMedia).toHaveBeenCalledTimes(2)
    expect(video.srcObject).toBe(cameras[1]!.stream)
    expect(cameras[1]!.track.stop).not.toHaveBeenCalled()
    expect(texts).toEqual(['CODE A', 'CODE B'])
    await frame()
    expect(texts).toEqual(['CODE A', 'CODE B', 'CODE C'])
  })

  test('coming back twice opens one camera, and the old camera ending is not a problem', async () => {
    const { camera, show, deps, problems } = await start([])
    await show(false)
    camera.end()
    await Promise.all([show(true), show(true)])
    await show(true)
    expect(deps.getUserMedia).toHaveBeenCalledTimes(2)
    expect(problems).toEqual([])
  })

  test('a scanner stopped while hidden stays stopped and stops watching the page', async () => {
    const { scanner, show, deps, watched } = await start([])
    await show(false)
    scanner.stop()
    expect(watched()).toBe(false)
    await show(true)
    expect(deps.getUserMedia).toHaveBeenCalledTimes(1)
  })

  test('a camera that cannot be opened again is reported once, and the scanner has stopped', async () => {
    const { show, deps, problems, watched, scheduled } = await start([])
    await show(false)
    deps.getUserMedia = vi.fn(async () => { throw new DOMException('no', 'NotAllowedError') })
    await show(true)
    expect(problems).toEqual(['denied'])
    expect(watched()).toBe(false)
    expect(scheduled()).toBe(false)
    await show(false)
    await show(true)
    expect(deps.getUserMedia).toHaveBeenCalledTimes(1)
  })

  test('a camera that opens after the page was hidden is not kept', async () => {
    const env = setup(['CODE A'])
    const video = fakeVideo()
    const texts: string[] = []
    let open!: (stream: MediaStream) => void
    env.deps.getUserMedia = vi.fn(() => new Promise<MediaStream>(resolve => { open = resolve }))
    const starting = startScanner(video, text => texts.push(text), () => {}, env.deps)
    await env.show(false)
    open(env.camera.stream)
    expect(await starting).toHaveProperty('stop')
    expect(env.camera.track.stop).toHaveBeenCalledTimes(1)
    expect(video.srcObject).toBeNull()
    expect(texts).toEqual([])
  })

  test('a scanner stopped before its camera opened lets the camera go when it does', async () => {
    const env = setup([])
    await env.show(false)
    const scanner = await startScanner(fakeVideo(), () => {}, () => {}, env.deps) as Scanner
    let open!: (stream: MediaStream) => void
    env.deps.getUserMedia = vi.fn(() => new Promise<MediaStream>(resolve => { open = resolve }))
    await env.show(true)
    scanner.stop()
    const late = fakeStream()
    open(late.stream)
    await env.show(true)
    expect(late.track.stop).toHaveBeenCalledTimes(1)
  })
})

/** A QR code as camera pixels: black modules on white, with the quiet zone, `scale` pixels per module. */
function picture(text: string, scale: number, invert = false): Frame {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' })
  const size = qr.modules.size
  const margin = 4
  const width = (size + 2 * margin) * scale
  const data = new Uint8ClampedArray(width * width * 4)
  for (let y = 0; y < width; y++) {
    for (let x = 0; x < width; x++) {
      const mx = Math.floor(x / scale) - margin
      const my = Math.floor(y / scale) - margin
      const dark = mx >= 0 && my >= 0 && mx < size && my < size && qr.modules.get(my, mx) === 1
      const value = dark !== invert ? 0 : 255
      data.set([value, value, value, 255], (y * width + x) * 4)
    }
  }
  return { data, width, height: width }
}

describe('the decoder', () => {
  const link = `https://magnetar.codefusion.cc/link#d=Dev1&i=Key1&k=${'A'.repeat(43)}`

  test('reads the QR code the device shows, at the size a phone sees it', async () => {
    for (const scale of [3, 5, 8]) expect(await decodeQr(picture(link, scale)), `scale ${scale}`).toBe(link)
  })

  test('reads a hostile text exactly as written, and leaves judging it to the caller', async () => {
    const hostile = 'javascript:alert(document.cookie)'
    expect(await decodeQr(picture(hostile, 6))).toBe(hostile)
  })

  test('finds nothing in a blank picture or in noise', async () => {
    expect(await decodeQr({ data: new Uint8ClampedArray(200 * 200 * 4).fill(255), width: 200, height: 200 })).toBeNull()
    const noise = new Uint8ClampedArray(200 * 200 * 4)
    for (let i = 0; i < noise.length; i++) noise[i] = (i * 2654435761) % 256
    expect(await decodeQr({ data: noise, width: 200, height: 200 })).toBeNull()
  })
})

afterEach(() => vi.restoreAllMocks())
beforeEach(() => vi.restoreAllMocks())
