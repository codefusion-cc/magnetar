/**
 * Reads QR codes from the camera, in the page: frames are drawn to a canvas in memory and decoded there, and never
 * sent anywhere. jsQR is loaded when a scanner opens, so pages that never scan do not carry it. Safari has no
 * `BarcodeDetector`, which is why the decoder is not the browser's.
 */

export type ScannerProblem =
  /** The person, or the system, said no to the camera. */
  | 'denied'
  | 'no-camera'
  /** Another app has the camera, or it stopped while scanning. */
  | 'busy'
  /** No camera API here: an insecure page, or a browser without it. */
  | 'unsupported'

export interface Frame {
  data: Uint8ClampedArray
  width: number
  height: number
}

/** What a scanner leans on; the browser's by default. Tests replace them. */
export interface ScannerDeps {
  getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream>
  /** The video's current picture, at most `MAX_WIDTH` wide, or null when there is none yet. */
  grab(video: HTMLVideoElement): Frame | null
  decode(frame: Frame): Promise<string | null>
  /** Calls `run` after `ms`; returns how to cancel. */
  later(run: () => void, ms: number): () => void
  now(): number
  /** Whether nobody can see the page: a tab in the background, an app put away, a locked screen. */
  hidden(): boolean
  /** Calls `run` whenever `hidden` may have changed; returns how to stop. */
  onVisibility(run: () => void): () => void
}

const MAX_WIDTH = 640
const EVERY_MS = 120
/** The same code in view is reported again no sooner than this, so a message about it can come back. */
const REPEAT_MS = 2_000

let decoder: Promise<(frame: Frame) => string | null> | undefined

/** The text of the QR code in `frame`, or null. The decoder is fetched the first time. */
export async function decodeQr(frame: Frame): Promise<string | null> {
  decoder ??= import('jsqr')
    .then(({ default: jsQR }) => (f: Frame) => jsQR(f.data, f.width, f.height, { inversionAttempts: 'dontInvert' })?.data ?? null)
    // A chunk that failed to load (a dropped connection) is fetched again with the next frame, not kept as the answer.
    .catch(error => {
      decoder = undefined
      throw error
    })
  return (await decoder)(frame)
}

function browserDeps(): ScannerDeps {
  const canvas = document.createElement('canvas')
  return {
    getUserMedia: constraints => navigator.mediaDevices.getUserMedia(constraints),
    grab(video) {
      if (video.readyState < 2 || !video.videoWidth) return null
      const scale = Math.min(1, MAX_WIDTH / video.videoWidth)
      const width = Math.round(video.videoWidth * scale)
      const height = Math.round(video.videoHeight * scale)
      // Setting a canvas's size clears and reallocates it, even to the size it has.
      if (canvas.width !== width) canvas.width = width
      if (canvas.height !== height) canvas.height = height
      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (!context) return null
      context.drawImage(video, 0, 0, canvas.width, canvas.height)
      return context.getImageData(0, 0, canvas.width, canvas.height)
    },
    decode: decodeQr,
    later: (run, ms) => {
      const timer = setTimeout(run, ms)
      return () => clearTimeout(timer)
    },
    now: () => Date.now(),
    hidden: () => document.visibilityState === 'hidden',
    onVisibility: run => {
      document.addEventListener('visibilitychange', run)
      return () => document.removeEventListener('visibilitychange', run)
    },
  }
}

function problemOf(error: unknown): ScannerProblem {
  const name = error instanceof Error || error instanceof DOMException ? error.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied'
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'no-camera'
  // `navigator.mediaDevices` is missing on an insecure page and in browsers without a camera API.
  if (name === 'TypeError' || name === 'NotSupportedError') return 'unsupported'
  return 'busy'
}

export interface Scanner {
  stop(): void
}

/**
 * Opens the camera into `video` and reports what each QR code in view says, until `stop`. `onText` hears the same
 * text again only after a while; `onProblem` hears of a camera that stops, and the scanner has stopped then. The
 * camera runs only while the page can be seen: it is let go when the page is hidden and opened again when it is back.
 * Resolves with the problem when the camera cannot be opened. Never throws.
 */
export async function startScanner(
  video: HTMLVideoElement,
  onText: (text: string) => void,
  onProblem: (problem: ScannerProblem) => void,
  deps: ScannerDeps = browserDeps(),
): Promise<Scanner | { problem: ScannerProblem }> {
  let stopped = false
  let opening = false
  /** Lets go of the camera that is open now; null while none is. */
  let release: (() => void) | null = null
  let unwatch = (): void => {}
  const stop = (): void => {
    stopped = true
    unwatch()
    release?.()
  }

  /** Opens the camera and reads from it until `release`. Resolves with why it could not, or null. */
  const open = async (): Promise<ScannerProblem | null> => {
    let stream: MediaStream
    try {
      stream = await deps.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' } } })
    } catch (error) {
      return problemOf(error)
    }
    let live = true
    let ended = false
    let cancel = (): void => {}
    const close = (): void => {
      if (!live) return
      live = false
      release = null
      cancel()
      for (const track of stream.getTracks()) track.stop()
      video.srcObject = null
    }
    // Stopped or hidden while the camera was opening: it is not kept.
    if (stopped || deps.hidden()) {
      for (const track of stream.getTracks()) track.stop()
      return null
    }
    release = close
    for (const track of stream.getVideoTracks()) {
      track.addEventListener('ended', () => {
        if (!live) return
        ended = true
        stop()
        onProblem('busy')
      })
    }
    video.srcObject = stream
    video.muted = true
    video.setAttribute('playsinline', '')
    await video.play().catch(() => {})
    if (ended) return 'busy'

    let last = ''
    let lastAt = 0
    const scan = async (): Promise<void> => {
      if (!live) return
      try {
        const frame = deps.grab(video)
        const text = frame && await deps.decode(frame)
        if (live && text && (text !== last || deps.now() - lastAt >= REPEAT_MS)) {
          last = text
          lastAt = deps.now()
          onText(text)
        }
      } catch {
        // One frame that cannot be read is skipped.
      }
      if (live) cancel = deps.later(() => void scan(), EVERY_MS)
    }
    void scan()
    return null
  }

  const problem = await open()
  if (problem) return { problem }
  const follow = (): void => {
    if (stopped) return
    if (deps.hidden()) return release?.()
    if (opening || release) return
    opening = true
    void open().then(failed => {
      opening = false
      if (!failed || stopped) return
      stop()
      onProblem(failed)
    })
  }
  unwatch = deps.onVisibility(follow)
  // Hidden while the camera was opening.
  follow()
  return { stop }
}
