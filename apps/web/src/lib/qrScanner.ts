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
}

const MAX_WIDTH = 640
const EVERY_MS = 120
/** The same code in view is reported again no sooner than this, so a message about it can come back. */
const REPEAT_MS = 2_000

let decoder: Promise<(frame: Frame) => string | null> | undefined

function browserDeps(): ScannerDeps {
  const canvas = document.createElement('canvas')
  return {
    getUserMedia: constraints => navigator.mediaDevices.getUserMedia(constraints),
    grab(video) {
      if (video.readyState < 2 || !video.videoWidth) return null
      const scale = Math.min(1, MAX_WIDTH / video.videoWidth)
      canvas.width = Math.round(video.videoWidth * scale)
      canvas.height = Math.round(video.videoHeight * scale)
      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (!context) return null
      context.drawImage(video, 0, 0, canvas.width, canvas.height)
      return context.getImageData(0, 0, canvas.width, canvas.height)
    },
    async decode(frame) {
      decoder ??= import('jsqr').then(({ default: jsQR }) => (f: Frame) => jsQR(f.data, f.width, f.height, { inversionAttempts: 'dontInvert' })?.data ?? null)
      return (await decoder)(frame)
    },
    later: (run, ms) => {
      const timer = setTimeout(run, ms)
      return () => clearTimeout(timer)
    },
    now: () => Date.now(),
  }
}

function problemOf(error: unknown): ScannerProblem {
  const name = error instanceof Error || error instanceof DOMException ? error.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied'
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'no-camera'
  return 'busy'
}

export interface Scanner {
  stop(): void
}

/**
 * Opens the camera into `video` and reports what each QR code in view says, until `stop`. `onText` hears the same
 * text again only after a while; `onProblem` hears of a camera that stops. Resolves with the problem when the camera
 * cannot be opened. Never throws.
 */
export async function startScanner(
  video: HTMLVideoElement,
  onText: (text: string) => void,
  onProblem: (problem: ScannerProblem) => void,
  deps: ScannerDeps = browserDeps(),
): Promise<Scanner | { problem: ScannerProblem }> {
  let stream: MediaStream
  try {
    stream = await deps.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' } } })
  } catch (error) {
    return { problem: problemOf(error) }
  }
  let stopped = false
  let cancel = (): void => {}
  const stop = (): void => {
    stopped = true
    cancel()
    for (const track of stream.getTracks()) track.stop()
    video.srcObject = null
  }
  for (const track of stream.getVideoTracks()) {
    track.addEventListener('ended', () => {
      if (stopped) return
      stop()
      onProblem('busy')
    })
  }
  video.srcObject = stream
  video.muted = true
  video.setAttribute('playsinline', '')
  await video.play().catch(() => {})
  if (stopped) return { problem: 'busy' }

  let last = ''
  let lastAt = 0
  const scan = async (): Promise<void> => {
    if (stopped) return
    try {
      const frame = deps.grab(video)
      const text = frame && await deps.decode(frame)
      if (!stopped && text && (text !== last || deps.now() - lastAt >= REPEAT_MS)) {
        last = text
        lastAt = deps.now()
        onText(text)
      }
    } catch {
      // One frame that cannot be read is skipped.
    }
    if (!stopped) cancel = deps.later(() => void scan(), EVERY_MS)
  }
  void scan()
  return { stop }
}
