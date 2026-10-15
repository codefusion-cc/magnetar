import type { CloudDeviceDto } from '@magnetar/protocol/cloud'
import { linkCodeSymbols } from '@magnetar/protocol/link-code'
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { cloud } from '../lib/cloudApi.ts'
import { useT } from '../lib/i18n.tsx'
import { isInstalledApp } from '../lib/installedApp.ts'
import { linkWithCode, linkWithKey, type LinkResult } from '../lib/linkDevice.ts'
import { MAX_LINK_INPUT, readLinkInput, shapeCodeField, type LinkInput, type LinkInputProblem } from '../lib/linkInput.ts'
import { startScanner, type Scanner, type ScannerProblem } from '../lib/qrScanner.ts'
import { Empty } from '../ui/Empty.tsx'
import { useToast } from '../ui/toast.tsx'
import { devicePath } from './devicePaths.ts'
import { linkTitle } from './linkWording.ts'

type Mode = 'scan' | 'type'

const RESULT_TEXT: Record<Exclude<LinkResult, 'linked'>, string> = {
  wrong: 'link.wrong',
  'device-offline': 'link.deviceOffline',
  network: 'link.network',
  slow: 'link.slow',
  removed: 'remote.removed',
  'signed-out': 'remote.signedOut',
  failed: 'link.failed',
  storage: 'link.storage',
}

const CAMERA_TEXT: Record<ScannerProblem, string> = {
  denied: 'link.cameraDenied',
  'no-camera': 'link.noCamera',
  busy: 'link.cameraBusy',
  unsupported: 'link.cameraUnsupported',
}

const INPUT_TEXT: Record<LinkInputProblem['problem'], string> = {
  incomplete: 'link.codeIncomplete',
  'too-long': 'link.codeTooLong',
  characters: 'link.codeCharacters',
  'other-site': 'link.otherSite',
  'not-a-link': 'link.notMagnetar',
}

/**
 * What a browser that holds no key for a device shows: it links itself there, by scanning the QR code with its own
 * camera or by typing the code the device shows beside it, without leaving the page. A phone's installed web app
 * cannot be linked any other way, since the camera app opens links in Safari, whose storage is not the app's.
 */
export function NotLinked({ device, onLinked }: { device: CloudDeviceDto; onLinked: () => void }) {
  const t = useT()
  const navigate = useNavigate()
  const toast = useToast()
  const [mode, setMode] = useState<Mode>('type')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [camera, setCamera] = useState<ScannerProblem | 'opening' | null>(null)
  const [seen, setSeen] = useState<string | null>(null)
  const [text, setText] = useState('')
  const alive = useRef(true)
  const panel = useRef<HTMLElement>(null)
  const field = useRef<HTMLInputElement>(null)
  const video = useRef<HTMLVideoElement>(null)
  const [attempt, setAttempt] = useState(0)
  const [title] = useState(() => linkTitle(isInstalledApp()))
  useEffect(() => () => { alive.current = false }, [])

  /** A link that did not work goes back to the code field (from the camera too), in the render that ends `busy`. */
  const complete = useCallback(async (input: LinkInput): Promise<boolean> => {
    setBusy(true)
    setError(null)
    let target = device
    let problem: string | null = null
    if (input.kind === 'link' && input.deviceId !== device.id) {
      // A code made for another of the account's devices: link that one instead.
      const devices = await cloud.devices().catch(() => null)
      const found = devices?.find(d => d.id === input.deviceId)
      if (found) target = found
      else problem = t(devices ? 'link.otherAccount' : 'link.network')
    }
    if (!problem) {
      const result = await (input.kind === 'link' ? linkWithKey(target.id, input.keyId, input.key) : linkWithCode(target.id, input.code))
      if (result !== 'linked') problem = t(RESULT_TEXT[result], target.name)
    }
    if (!alive.current) return !problem
    if (problem) setMode('type')
    setBusy(false)
    if (problem) {
      setError(problem)
      return false
    }
    toast(t('link.linked', target.name), 'success')
    if (target.id === device.id) onLinked()
    else navigate(devicePath(target.name))
    return true
  }, [device, navigate, onLinked, t, toast])

  // The camera runs while the scanner is open, and only then.
  useEffect(() => {
    if (mode !== 'scan' || busy) return
    const element = video.current
    if (!element) return
    let scanner: Scanner | null = null
    let cancelled = false
    setCamera('opening')
    setSeen(null)
    void startScanner(element, scanned => {
      const read = readLinkInput(scanned, location.origin)
      if ('problem' in read) return setSeen(read.problem === 'other-site' ? 'link.otherSite' : 'link.notMagnetar')
      scanner?.stop()
      void complete(read)
    }, problem => !cancelled && setCamera(problem)).then(started => {
      if (cancelled) return 'stop' in started ? started.stop() : undefined
      if ('problem' in started) return setCamera(started.problem)
      scanner = started
      setCamera(null)
    })
    return () => {
      cancelled = true
      scanner?.stop()
    }
  }, [mode, busy, complete, attempt])

  // Moving between the field and the camera keeps the keyboard's place: the field, or the page for the camera.
  // On arrival the page itself (its heading is read out, and a phone's keyboard stays down).
  const moved = useRef(false)
  useEffect(() => {
    if (moved.current && mode === 'type') field.current?.focus()
    else panel.current?.focus()
  }, [mode])

  const open = (next: Mode) => {
    moved.current = true
    setError(null)
    setCamera(null)
    setMode(next)
  }

  const submit = () => {
    if (busy) return
    const read = readLinkInput(text, location.origin)
    if ('problem' in read) {
      return setError(t(INPUT_TEXT[read.problem], read.problem === 'characters' ? read.character : linkCodeSymbols(text).length))
    }
    void complete(read)
  }

  const typed = (event: ChangeEvent<HTMLInputElement>) => {
    const field = event.target
    const native = event.nativeEvent as InputEvent
    setError(null)
    // A keyboard that is still composing a word loses its place when the text changes under it: it is shaped after.
    if (native.isComposing) return setText(field.value)
    const shaped = shapeCodeField(field.value, field.selectionStart ?? field.value.length, text, native.inputType === 'deleteContentForward')
    // Written to the field at once, so the caret can be put where it belongs before React renders the same text.
    field.value = shaped.text
    field.setSelectionRange(shaped.caret, shaped.caret)
    setText(shaped.text)
  }
  const settle = () => setText(current => shapeCodeField(current, current.length).text)

  // The name stays in one piece: a hyphen in it is no place to break the title.
  const [beforeName, afterName = ''] = t(title, '{0}').split('{0}')

  return (
    <Empty appearance="page" heading="h1" state="far" ref={panel} tabIndex={-1} className="not-linked"
      title={<>{beforeName}<span className="not-linked-name">{device.name}</span>{afterName}</>}
      text={t('link.notLinkedHint')}>
      {mode === 'type' && (
        <>
          <form className="link-code" onSubmit={e => { e.preventDefault(); submit() }} noValidate>
            <label htmlFor="link-code">{t('link.codeLabel')}</label>
            <div className="setting-inline">
              <input
                ref={field}
                id="link-code"
                className="link-code-input"
                value={text}
                onChange={typed}
                onCompositionEnd={settle}
                onBlur={settle}
                readOnly={busy}
                placeholder="XXXXX-XXXXX-XXXXX-XXXXX"
                maxLength={MAX_LINK_INPUT}
                inputMode="text"
                autoCapitalize="characters"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="go"
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? 'link-code-error link-code-help' : 'link-code-help'}
              />
              <button type="submit" className="infall-button" disabled={busy || !text.trim()} aria-busy={busy}>{t('devices.link')}</button>
            </div>
            <p id="link-code-help" className="fine">{t('link.codeHelp')}</p>
            {error && <p id="link-code-error" role="alert" className="setting-alert">{error}</p>}
            {busy && <p role="status" className="fine">{t('link.linking')}</p>}
          </form>
          <p className="infall-acts">
            <button type="button" className="setting-link" onClick={() => open('scan')} disabled={busy}>{t('link.scan')}</button>
            <Link to="/" className="setting-link">{t('devices.back')}</Link>
          </p>
        </>
      )}

      {mode === 'scan' && (
        <>
          {(camera === null || camera === 'opening') && (
            <div className="link-camera">
              <video ref={video} playsInline muted aria-label={t('link.cameraView')} />
              {busy && <p role="status">{t('link.linking')}</p>}
            </div>
          )}
          {camera && camera !== 'opening'
            ? <p role="alert" className="setting-alert">{t(CAMERA_TEXT[camera])}</p>
            : <p role="status">{seen ? t(seen) : camera === 'opening' ? t('link.cameraOpening') : t('link.scanHint')}</p>}
          {error && <p role="alert" className="setting-alert">{error}</p>}
          <p className="infall-acts">
            {(camera === 'denied' || camera === 'busy') && (
              <button type="button" className="infall-button" onClick={() => { setCamera(null); setAttempt(n => n + 1) }}>{t('common.retry')}</button>
            )}
            <button type="button" className="setting-link" onClick={() => open('type')} disabled={busy}>{t('link.type')}</button>
            <Link to="/" className="setting-link">{t('devices.back')}</Link>
          </p>
        </>
      )}
    </Empty>
  )
}
