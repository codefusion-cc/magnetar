import type { FolderEntryDto, FolderPageDto, FolderRootDto, FolderRootsDto } from '@magnetar/protocol'
import {
  Download, FolderPlus, HardDrive, House, Info, Plus,
  RefreshCw, X,
} from 'lucide-react'
import { memo, useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { errorMessage } from '../../lib/errors.ts'
import { appendPage, baseName, crumbs, isWithin, joinPath, separatorOf, type Crumb, type Separator } from '../../lib/folderPaths.ts'
import { useFormatBytes, useFormatDate, useLanguage, useT } from '../../lib/i18n.tsx'
import { RpcError } from '../../lib/rpcClient.ts'
import { Field } from '../../ui/fields.tsx'
import { ConfirmDialog } from '../../ui/Modal.tsx'
import { ShowMore } from '../../ui/ShowMore.tsx'
import { Empty } from '../../ui/Empty.tsx'
import { Loading } from '../../ui/Loading.tsx'
import { downloadDay } from '../../lib/downloadPresentation.ts'
import { useDevice, useDownload } from '../DeviceContext.tsx'
import { useRun } from '../useRun.ts'

/** The folders the dashboard may browse, read again when the download folder moves (the old one may stay as added). */
export function useRoots() {
  const { connection, settings, info } = useDevice()
  const supported = info?.fileBrowser === true
  const [roots, setRoots] = useState<FolderRootsDto | null>(null)
  const [error, setError] = useState<string | null>(null)
  const latest = useRef(0)
  const reload = useCallback(() => {
    if (!supported) return
    const id = ++latest.current
    setError(null)
    connection.call('fs.roots').then(
      next => { if (id === latest.current) setRoots(next) },
      (e: unknown) => { if (id === latest.current) setError(errorMessage(e)) },
    )
  }, [connection, supported])
  const downloadFolder = settings?.downloadFolder
  useEffect(reload, [reload, downloadFolder])
  return { supported, roots, error, reload, setRoots }
}

/** The name a root goes by: "Download folder", or its own name. */
export function rootLabel(root: Pick<FolderRootDto, 'kind' | 'path'>, separator: Separator, t: ReturnType<typeof useT>): string {
  return root.kind === 'downloads' ? t('files.downloadFolder') : baseName(root.path, separator)
}

type FolderState =
  | { status: 'loading'; path: string }
  | { status: 'error'; path: string; message: string; code: string }
  | { status: 'ready'; page: FolderPageDto; entries: FolderEntryDto[]; next: number; more: 'idle' | 'loading' }

/**
 * A folder's entries as its pages arrive: the first on opening, the next on asking. Answers for a folder left in the
 * meantime are dropped, and a folder that failed for want of a connection is read again once it is back.
 */
function useFolder(path: string | null, foldersOnly: boolean) {
  const { connection, connectionState } = useDevice()
  const [state, setState] = useState<FolderState | null>(null)
  const current = useRef(state)
  current.current = state
  const latest = useRef(0)

  const reload = useCallback(() => {
    const id = ++latest.current
    if (path === null) return setState(null)
    setState({ status: 'loading', path })
    connection.call('fs.browse', { path, foldersOnly }).then(
      page => { if (id === latest.current) setState({ status: 'ready', page, entries: page.entries, next: page.entries.length, more: 'idle' }) },
      (e: unknown) => {
        if (id === latest.current) setState({ status: 'error', path, message: errorMessage(e), code: e instanceof RpcError ? e.code : 'internal' })
      },
    )
  }, [connection, path, foldersOnly])
  useEffect(reload, [reload])

  const offline = state?.status === 'error' && state.code === 'offline'
  useEffect(() => {
    if (offline && connectionState.status === 'open') reload()
  }, [offline, connectionState.status, reload])

  const run = useRun()
  const loadMore = useCallback(() => {
    const shown = current.current
    if (shown?.status !== 'ready' || shown.more === 'loading' || shown.next >= shown.page.total) return
    const id = latest.current
    current.current = { ...shown, more: 'loading' }
    setState(current.current)
    void run(() => connection.call('fs.browse', { path: shown.page.path, offset: shown.next, foldersOnly }), 'files.moreFailed')
      .then(page => {
        if (id !== latest.current) return
        const now = current.current
        if (now?.status !== 'ready') return
        setState(page
          ? { ...now, page, entries: appendPage(now.entries, page.entries), next: now.next + page.entries.length, more: 'idle' }
          : { ...now, more: 'idle' })
      })
  }, [connection, foldersOnly, run])

  return { state, reload, loadMore }
}

/** The way back from a folder to the folders that can be browsed, each step a link. */
function Breadcrumbs({ trail, onOpen, onHome, plain = false }: { trail: Crumb[]; onOpen: (path: string) => void; onHome: () => void; plain?: boolean }) {
  const t = useT()
  return (
    <nav aria-label={t('files.breadcrumb')} className={plain ? 'folder-crumb' : 'breadcrumbs scroll-strip strip-bleed py-0 text-sm'}>
      <ul>
        {!plain && <li>
          <button type="button" className="link link-hover inline-flex items-center gap-1.5" onClick={onHome}>
            <House size={14} aria-hidden />{t('files.title')}
          </button>
        </li>}
        {trail.map((crumb, i) => (
          <li key={crumb.path}>
            {plain && i > 0 && <span aria-hidden="true">/</span>}
            {i === trail.length - 1
              ? <span aria-current="page" className="max-w-[16rem] truncate font-medium" title={crumb.path}>{crumb.name}</span>
              : <button type="button" className="link link-hover max-w-[12rem] truncate" title={crumb.path} onClick={() => onOpen(crumb.path)}>{crumb.name}</button>}
          </li>
        ))}
      </ul>
    </nav>
  )
}

/** One line of text to send, with its own busy and error states: a new folder's name, a folder to add. */
function TextForm({ label, submitLabel, help, placeholder, mono = false, onSubmit, onCancel }: {
  label: string
  submitLabel: string
  help?: string
  placeholder?: string
  mono?: boolean
  /** Rejects with what to show under the field. */
  onSubmit: (value: string) => Promise<void>
  onCancel: () => void
}) {
  const t = useT()
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submit = async () => {
    if (!value.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      await onSubmit(value.trim())
    } catch (e) {
      setError(errorMessage(e))
      setBusy(false)
    }
  }
  return (
    <form className="mb-3" onSubmit={e => { e.preventDefault(); void submit() }}
      onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); onCancel() } }}>
      <Field label={label} help={error ? <span role="alert" className="text-error">{error}</span> : help}>
        <span className="flex flex-wrap gap-2">
          <input data-autofocus autoFocus className={`input input-sm min-w-0 flex-1 ${mono ? 'font-mono' : ''}`} value={value} maxLength={4096}
            placeholder={placeholder} autoComplete="off" aria-invalid={error !== null} onChange={e => setValue(e.target.value)} />
          <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !value.trim()}>
            {busy && <span className="loading loading-spinner loading-xs" />}{submitLabel}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>{t('common.cancel')}</button>
        </span>
      </Field>
    </form>
  )
}

/**
 * One folder: its breadcrumb, a few actions, and its entries, folders first. `onOpen` goes into a folder; files of a
 * download offer what the dashboard already does with them (`fileActions`).
 */
export function FolderPanel({ path, roots, foldersOnly = false, onOpen, onHome, toolbar, fileActions, compact = false, status, onReady, header }: {
  header?: (actions: ReactNode) => ReactNode
  path: string
  roots: FolderRootDto[]
  foldersOnly?: boolean
  onOpen: (path: string) => void
  onHome: () => void
  /** Actions for the folder shown, beside Refresh and New folder. */
  toolbar?: (page: FolderPageDto) => ReactNode
  fileActions?: (entry: FolderEntryDto) => ReactNode
  /** Inside a dialog: no heading of its own, a list that scrolls. */
  compact?: boolean
  /** Beside the folder's name and count: what to know about where it is, such as its free space. */
  status?: (root: FolderRootDto | undefined) => ReactNode
  /** Called once each time the folder's listing has loaded. */
  onReady?: () => void
}) {
  const t = useT()
  const formatDate = useFormatDate()
  const formatBytes = useFormatBytes()
  const language = useLanguage()
  const { connection } = useDevice()
  const { state, reload, loadMore } = useFolder(path, foldersOnly)
  const [making, setMaking] = useState(false)
  const headingId = useId()
  const heading = useRef<HTMLHeadingElement>(null)
  // Arriving in another folder, keyboard and screen reader users land on its name once it is read; not on opening.
  const announced = useRef(path)
  const settled = state?.status === 'ready' || state?.status === 'error'
  useEffect(() => {
    if (settled && announced.current !== path) {
      announced.current = path
      heading.current?.focus({ preventScroll: compact })
    }
  }, [settled, path, compact])
  useEffect(() => setMaking(false), [path])
  const listed = state?.status === 'ready'
  useEffect(() => { if (listed) onReady?.() }, [listed, path])

  const page = state?.status === 'ready' ? state.page : null
  const separator = page?.separator ?? separatorOf(path)
  const entries = state?.status === 'ready' ? state.entries : null
  const rows = useMemo(() => entries?.map(entry => {
    const modifiedToday = entry.modified !== null && new Date(entry.modified).toDateString() === new Date().toDateString()
    const facts = [entry.size !== null ? formatBytes(entry.size) : null, entry.modified && downloadDay(language, entry.modified, modifiedToday, new Date(), 'file')].filter(Boolean) as string[]
    return { entry, facts, title: entry.modified ? formatDate(entry.modified, true) : undefined }
  }) ?? [], [entries, formatBytes, formatDate, language])
  const openEntry = useCallback((name: string) => onOpen(joinPath(page?.path ?? path, name, separator)), [onOpen, page?.path, path, separator])
  // Before the page says, the outermost root holding the folder, as the device picks it.
  const root = page?.root ?? roots.filter(r => isWithin(path, r.path, separator)).sort((a, b) => a.path.length - b.path.length)[0]?.path ?? path
  const rootFound = roots.find(r => r.path === root)
  const trail = crumbs(root, path, separator).map((crumb, i) => (i === 0 && rootFound ? { ...crumb, name: rootLabel(rootFound, separator, t) } : crumb))
  const up = trail.at(-2)?.path ?? null
  const name = trail.at(-1)!.name

  // Backspace or Alt+↑ goes up a folder, unless typing.
  const onKeyDown = (event: KeyboardEvent) => {
    const typing = event.target instanceof HTMLElement && event.target.closest('input, textarea, select')
    if (typing || event.defaultPrevented) return
    if (event.key === 'Backspace' || (event.altKey && event.key === 'ArrowUp')) {
      event.preventDefault()
      if (up) onOpen(up)
      else onHome()
    }
  }

  const count = page && (foldersOnly
    ? t(page.total === 1 ? 'files.folderCountOne' : 'files.folderCount', page.total)
    : t(page.total === 1 ? 'files.itemCountOne' : 'files.itemCount', page.total))

  return (
    <section aria-labelledby={headingId} onKeyDown={onKeyDown} className={`folder-panel flex min-w-0 flex-col gap-3 ${compact ? 'folder-compact' : 'folder-full'}`}>
      {header?.(<button type="button" className="infall-button quiet" aria-expanded={making} disabled={state?.status !== 'ready'} onClick={() => setMaking(m => !m)}>{t('files.newFolder')}</button>)}
      {(!header || trail.length > 1) && <Breadcrumbs plain={Boolean(header)} trail={trail} onOpen={onOpen} onHome={onHome} />}
      <div className="folder-heading flex flex-wrap items-center gap-2">
        <h2 id={headingId} ref={heading} tabIndex={-1}
          className={`break-release min-w-0 flex-1 font-semibold outline-none ${compact ? 'text-base' : 'text-xl'}`}>
          {name}
        </h2>
        {count && <span className="muted text-sm tabular-nums">{count}</span>}
        {status?.(rootFound)}
      </div>
      <div className={`folder-toolbar flex flex-wrap items-center gap-2 ${header ? 'folder-secondary' : ''}`}>
        <button type="button" className="btn btn-ghost btn-sm" onClick={reload} disabled={state?.status === 'loading'}>
          <RefreshCw size={14} className={state?.status === 'loading' ? 'animate-spin' : ''} aria-hidden />{t('files.refresh')}
        </button>
        {!header && <button type="button" className="btn btn-ghost btn-sm" aria-expanded={making} disabled={state?.status !== 'ready'} onClick={() => setMaking(m => !m)}>
          <FolderPlus size={14} aria-hidden />{t('files.newFolder')}
        </button>}
        {!header && page && toolbar?.(page)}
      </div>
      {making && page && (
        <TextForm label={t('files.newFolderName')} submitLabel={t('files.create')} onCancel={() => setMaking(false)}
          onSubmit={async name => {
            const { path: made } = await connection.call('fs.createFolder', { parent: page.path, name })
            setMaking(false)
            onOpen(made)
          }} />
      )}

      {state?.status === 'loading' && <Loading text={t('files.reading')} rows={4} />}
      {state?.status === 'error' && <Empty appearance="download" role="alert" state="out" title={t('files.unreachable', name)} text={state.message}>
        <div className="infall-acts">{state.code !== 'forbidden' && <button className="infall-button" onClick={reload}>{t('common.retry')}</button>}
          <button className="infall-button quiet" onClick={() => (up ? onOpen(up) : onHome())}>{up ? t('files.up') : t('files.backToFiles')}</button>
        </div>
      </Empty>}
      {state?.status === 'ready' && (
        <>
          {header && trail.length === 1 && <p className="folder-where"><span role="note" aria-label={t('files.folderPath')}>{state.page.path}</span> {toolbar?.(state.page)}</p>}
          {state.page.truncated && <p className="muted text-xs">{t('files.truncated', state.page.total)}</p>}
          {state.entries.length === 0
            ? <p className="folder-empty">{t(foldersOnly ? 'files.noFolders' : 'files.empty')}</p>
            : (
              <ul aria-label={t('files.contents', name)} aria-busy={state.more === 'loading'}
                className={`folder-entries ${compact ? 'max-h-80 overflow-y-auto' : ''}`}>
                {rows.map(row => <EntryRow key={row.entry.name} {...row} onOpen={openEntry} fileActions={fileActions} />)}
              </ul>
            )}
          {state.entries.length === 0 && header && trail.length > 1 && toolbar?.(state.page)}
          {header && state.entries.length > 0 && <p className="folder-count">{count}</p>}
          {state.next < state.page.total && (
            state.more === 'loading'
              ? <div className="flex justify-center py-3"><span className="loading loading-spinner loading-sm text-primary" /></div>
              : <ShowMore remaining={state.page.total - state.next} onMore={loadMore} />
          )}
        </>
      )}
    </section>
  )
}

/** Only entries owned by a download subscribe to its once-a-second progress. */
function DownloadEntry({ entry, children }: { entry: FolderEntryDto; children: (percent: number | null) => ReactNode }) {
  const download = useDownload(entry.download!.id)
  return children(download && download.progress < 100 ? download.progress : null)
}

const EntryRow = memo(function EntryRow({ entry, facts, title, onOpen, fileActions }: {
  entry: FolderEntryDto; facts: string[]; title?: string
  onOpen: (name: string) => void; fileActions?: (entry: FolderEntryDto) => ReactNode
}) {
  const t = useT()
  const render = (percent: number | null) => <li className={`file-entry ${entry.kind === 'folder' ? 'dir' : ''} ${percent !== null ? 'part' : ''}`} style={{ '--z': Math.max(.15, Math.min(1, Math.log10(Math.max((entry.size ?? 1e8) / 1e6, 1)) / 4)) } as React.CSSProperties}>
    <span className="file-star" aria-hidden="true"><i /></span>
    <div className="file-body"><h2>{entry.kind === 'folder' ? <button type="button" onClick={() => onOpen(entry.name)}>{entry.name}</button> : entry.name}</h2>
      <p className="file-meta" title={title}>{facts.map(f => <span key={f}>{f}</span>)}
        {percent !== null && <span className="still-arriving">{t('files.arriving', Math.round(percent))}</span>}
      </p>
    </div>
    {entry.download && <div className="file-actions">{fileActions?.(entry)}</div>}
  </li>
  return entry.download ? <DownloadEntry entry={entry}>{render}</DownloadEntry> : render(null)
})

/** The folders that can be browsed, as cards; on the device itself, a way to add more. */
export function RootList({ roots, canAdd, onOpen, onChanged, compact = false }: {
  roots: FolderRootDto[]
  canAdd: boolean
  onOpen: (path: string) => void
  onChanged: (roots: FolderRootsDto) => void
  compact?: boolean
}) {
  const t = useT()
  const formatBytes = useFormatBytes()
  const run = useRun()
  const { connection, info, deviceName } = useDevice()
  const [adding, setAdding] = useState(false)
  const [removing, setRemoving] = useState<FolderRootDto | null>(null)
  const separator = separatorOf(roots[0]?.path ?? '/')

  const add = async () => {
    if (info?.nativeFolderPicker) {
      const picked = await run(() => connection.call('fs.pickNative', { prompt: t('files.addPrompt') }))
      if (picked === undefined) return
      if (picked.path) {
        const next = await run(() => connection.call('fs.addRoot', { path: picked.path! }), 'files.addFailed')
        if (next) onChanged(next)
      }
      return
    }
    setAdding(true)
  }
  const remove = async (root: FolderRootDto | null) => {
    setRemoving(null)
    if (!root) return
    const next = await run(() => connection.call('fs.removeRoot', { path: root.path }), 'files.removeFailed')
    if (next) onChanged(next)
  }

  return (
    <div className="flex flex-col gap-3">
      <ul className={`grid gap-3 ${compact ? '' : 'sm:grid-cols-2'}`} aria-label={t('files.roots')}>
        {roots.map(root => (
          <li key={root.path} className="surface flex items-stretch">
            <button type="button" className="flex min-w-0 flex-1 items-start gap-3 rounded-box p-4 text-left hover:bg-base-200/60" onClick={() => onOpen(root.path)}>
              {root.kind === 'downloads'
                ? <Download size={20} className="mt-0.5 shrink-0 text-primary" aria-hidden />
                : <HardDrive size={20} className="mt-0.5 shrink-0 text-primary" aria-hidden />}
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{rootLabel(root, separator, t)}</span>
                <span className="muted break-release mt-0.5 block font-mono text-xs">{root.path}</span>
                <span className="mt-1.5 flex flex-wrap gap-2 text-xs">
                  {root.available
                    ? root.freeBytes !== null && <span className="muted tabular-nums">{t('transfer.free', formatBytes(root.freeBytes))}</span>
                    : <span className="badge badge-soft badge-warning badge-sm">{t('files.unavailable')}</span>}
                </span>
              </span>
            </button>
            {root.kind === 'added' && canAdd && (
              <button type="button" className="btn btn-ghost btn-sm btn-square m-2" aria-label={t('files.remove', root.path)} title={t('files.remove', root.path)}
                onClick={() => setRemoving(root)}>
                <X size={16} aria-hidden />
              </button>
            )}
          </li>
        ))}
      </ul>
      {canAdd
        ? (adding
            ? <TextForm mono label={t('files.addPath')} submitLabel={t('files.addButton')} help={t('files.addHint')} placeholder={t('files.addPlaceholder')}
                onCancel={() => setAdding(false)}
                onSubmit={async path => {
                  const next = await connection.call('fs.addRoot', { path })
                  setAdding(false)
                  onChanged(next)
                }} />
            : (
              <div className="flex flex-wrap items-center gap-3">
                <button type="button" className="btn btn-sm" onClick={() => void add()}><Plus size={14} aria-hidden />{t('files.add')}</button>
                <span className="muted text-xs">{t('files.addHint')}</span>
              </div>
            ))
        : <p className="muted flex items-start gap-2 text-xs"><Info size={14} className="mt-0.5 shrink-0" aria-hidden />{t('files.addOnDevice', deviceName)}</p>}
      <ConfirmDialog open={removing !== null} title={t('files.removeTitle')} message={t('files.removeMessage', removing ? rootLabel(removing, separator, t) : '')}
        options={[{ label: t('common.cancel'), value: null, tone: 'ghost' }, { label: t('common.remove'), value: removing, tone: 'error' }]}
        onResult={root => void remove(root)} />
    </div>
  )
}

/** Play and Details for a file of a download, as the download's own details offer them. */
export function DownloadFileActions({ entry, onPlay, onDetails, playing }: {
  entry: FolderEntryDto
  onPlay: (entry: FolderEntryDto) => void
  onDetails: (id: number) => void
  playing: boolean
}) {
  const t = useT()
  if (!entry.download) return null
  return (
    <>
      {entry.media && entry.download.index !== undefined && (
        <button type="button" className="infall-small" disabled={playing}
          aria-label={t('player.play', entry.name)} title={t('player.play', entry.name)} onClick={() => onPlay(entry)}>
          {playing ? <span className="loading loading-spinner loading-xs" /> : t('details.play')}
        </button>
      )}
      <button type="button" className="infall-small" aria-label={t('files.details', entry.name)} title={t('files.details', entry.name)}
        onClick={() => onDetails(entry.download!.id)}>
        {t('files.detailsLabel')}
      </button>
    </>
  )
}
