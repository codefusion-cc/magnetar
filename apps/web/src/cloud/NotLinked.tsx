import type { CloudDeviceDto } from '@magnetar/protocol/cloud'
import { linkCodeKey } from '@magnetar/protocol/link-code'
import { Camera, Keyboard, LoaderCircle } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { cloud } from '../lib/cloudApi.ts'
import { useT } from '../lib/i18n.tsx'
import { linkWithKey, type LinkResult } from '../lib/linkDevice.ts'
import { readLinkInput, type LinkInput, type LinkInputProblem } from '../lib/linkInput.ts'
import { startScanner, type Scanner, type ScannerProblem } from '../lib/qrScanner.ts'
import { useToast } from '../ui/toast.tsx'
import { devicePath } from './devicePaths.ts'

type Mode = 'choose' | 'scan' | 'type'

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

const INPUT_TEXT: Record<LinkInputProblem, string> = {
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
  const [mode, setMode] = useState<Mode>('choose')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [camera, setCamera] = useState<ScannerProblem | 'opening' | null>(null)
  const [seen, setSeen] = useState<string | null>(null)
  const [text, setText] = useState('')
  const alive = useRef(true)
  const panel = useRef<HTMLDivElement>(null)
  const video = useRef<HTMLVideoElement>(null)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => () => { alive.current = false }, [])

  const complete = useCallback(async (input: LinkInput): Promise<boolean> => {
    setBusy(true)
    setError(null)
    let target = device
    let result: LinkResult | 'other-account' | 'list-failed'
    if (input.kind === 'link' && input.deviceId !== device.id) {
      // A code made for another of the account's devices: link that one instead.
      const devices = await cloud.devices().catch(() => null)
      const found = devices?.find(d => d.id === input.deviceId)
      if (found) target = found
      result = devices ? (found ? 'linked' : 'other-account') : 'list-failed'
    } else {
      result = 'linked'
    }
    if (result === 'linked') {
      result = input.kind === 'link'
        ? await linkWithKey(target.id, input.keyId, input.key)
        : await (async () => {
          const { keyId, key } = await linkCodeKey(input.code)
          return linkWithKey(target.id, keyId, key)
        })()
    }
    if (!alive.current) return result === 'linked'
    setBusy(false)
    if (result === 'linked') {
      toast(t('link.linked', target.name), 'success')
      if (target.id === device.id) onLinked()
      else navigate(devicePath(target.name))
      return true
    }
    setError(result === 'other-account' ? t('link.otherAccount') : result === 'list-failed' ? t('link.network') : t(RESULT_TEXT[result], device.name))
    return false
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
      void complete(read).then(linked => {
        if (!linked && alive.current) setMode('choose')
      })
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

  useEffect(() => {
    if (mode !== 'type') panel.current?.focus()
  }, [mode])

  const open = (next: Mode) => {
    setError(null)
    setCamera(null)
    setMode(next)
  }

  const submit = () => {
    if (busy) return
    const read = readLinkInput(text, location.origin)
    if ('problem' in read) {
      const count = text.replace(/[\s-]/g, '').length
      return setError(t(INPUT_TEXT[read.problem], count))
    }
    void complete(read)
  }

  return (
    <div ref={panel} tabIndex={-1} className="surface mx-auto flex w-full max-w-md flex-col gap-4 p-6 outline-none">
      <h1 className="text-xl font-bold">{t('link.notLinkedTitle', device.name)}</h1>

      {mode === 'choose' && (
        <>
          <p className="text-sm text-base-content/70">{t('link.notLinkedHint')}</p>
          {error && <p role="alert" className="alert alert-error alert-soft text-sm">{error}</p>}
          <button type="button" className="btn btn-primary btn-lg w-full" onClick={() => open('scan')}><Camera size={20} />{t('link.scan')}</button>
          <button type="button" className="btn btn-lg w-full" onClick={() => open('type')}><Keyboard size={20} />{t('link.type')}</button>
        </>
      )}

      {mode === 'scan' && (
        <>
          {(camera === null || camera === 'opening') && (
            <div className="relative aspect-square w-full overflow-hidden rounded-box bg-neutral">
              <video ref={video} className="size-full object-cover" playsInline muted aria-label={t('link.cameraView')} />
              {busy && (
                <div role="status" className="absolute inset-0 grid place-items-center bg-neutral/80 text-neutral-content">
                  <span className="flex items-center gap-2 text-sm"><LoaderCircle size={18} className="animate-spin" />{t('link.linking')}</span>
                </div>
              )}
            </div>
          )}
          {camera && camera !== 'opening' ? (
            <p role="alert" className="alert alert-warning alert-soft text-sm">{t(CAMERA_TEXT[camera])}</p>
          ) : (
            <p role="status" className="text-sm text-base-content/70">{seen ? t(seen) : camera === 'opening' ? t('link.cameraOpening') : t('link.scanHint')}</p>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn flex-none whitespace-nowrap" onClick={() => open('choose')} disabled={busy}>{t('link.back')}</button>
            {(camera === 'denied' || camera === 'busy') && (
              <button type="button" className="btn flex-1" onClick={() => { setCamera(null); setAttempt(n => n + 1) }}>{t('common.retry')}</button>
            )}
            <button type="button" className="btn btn-primary flex-1 whitespace-nowrap" onClick={() => open('type')} disabled={busy}><Keyboard size={16} />{t('link.type')}</button>
          </div>
        </>
      )}

      {mode === 'type' && (
        <form className="flex flex-col gap-4" onSubmit={e => { e.preventDefault(); submit() }} noValidate>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">{t('link.codeLabel')}</span>
            <input
              className={`input input-lg w-full font-mono uppercase tracking-wider ${error ? 'input-error' : ''}`}
              value={text}
              onChange={e => { setText(e.target.value); setError(null) }}
              disabled={busy}
              autoFocus
              autoCapitalize="characters"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="go"
              aria-invalid={error ? true : undefined}
              aria-describedby="link-code-help"
            />
            <span id="link-code-help" className="muted text-xs">{t('link.codeHelp')}</span>
          </label>
          {error && <p role="alert" className="alert alert-error alert-soft text-sm">{error}</p>}
          {busy && <p role="status" className="flex items-center gap-2 text-sm text-base-content/70"><LoaderCircle size={16} className="animate-spin" />{t('link.linking')}</p>}
          <button type="submit" className="btn btn-primary btn-lg w-full" disabled={busy || !text.trim()}>{t('link.submit')}</button>
          <div className="flex gap-2">
            <button type="button" className="btn flex-none whitespace-nowrap" onClick={() => open('choose')} disabled={busy}>{t('link.back')}</button>
            <button type="button" className="btn flex-1 whitespace-nowrap" onClick={() => open('scan')} disabled={busy}><Camera size={16} />{t('link.scan')}</button>
          </div>
        </form>
      )}
    </div>
  )
}
