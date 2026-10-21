import { compareVersions, parseReleaseNotes } from '@codefusion-cc/app-update'
import { ReleaseNotes, type ReleaseNotesClasses } from '@codefusion-cc/app-update/react'
import type { ReleaseDto, ReleasesDto } from '@magnetar/protocol'
import { ExternalLink } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useFormatDate, useT } from '../lib/i18n.tsx'
import { releasesProblemText } from '../lib/releases.ts'
import { Loading } from './Loading.tsx'
import { Tag } from './Tag.tsx'
import { MAGNETAR_REPO } from '@magnetar/protocol/cloud'

/** Releases shown before "Older releases" when none is newer than the one running. */
const SHOWN = 3

type State = { status: 'loading' } | { status: 'ready'; releases: ReleaseDto[]; problem: ReleasesDto['problem'] } | { status: 'failed' }

/**
 * What each release brings, newest first, from its notes on GitHub. With `running`, the release this app runs is
 * marked and the ones after it stand out as new; older ones fold away. `load` reads the releases: the device's own
 * (`updates.releases`) or the website's (`/api/releases`).
 */
export function Changelog({ load, running }: { load: () => Promise<ReleasesDto>; running?: string | null }) {
  const t = useT()
  const formatDate = useFormatDate()
  const [state, setState] = useState<State>({ status: 'loading' })
  const read = useCallback(() => {
    let cancelled = false
    setState({ status: 'loading' })
    load().then(
      ({ releases, problem }) => !cancelled && setState({ status: 'ready', releases, problem }),
      () => !cancelled && setState({ status: 'failed' }),
    )
    return () => { cancelled = true }
  }, [load])
  useEffect(read, [read])

  if (state.status === 'loading') {
    return (
      <div className="releases"><Loading skeletonOnly rows={2} text={t('changelog.loading')} /></div>
    )
  }
  if (state.status === 'failed' || (state.problem && !state.releases.length)) {
    const text = state.status === 'ready' && state.problem ? releasesProblemText(t, state.problem, null, formatDate) : t('releases.unavailable')
    return (
      <div role="alert" className="releases-trouble">
        <p>{text}</p>
        <button type="button" className="infall-small sm" onClick={read}>{t('changelog.retry')}</button>
      </div>
    )
  }
  if (!state.releases.length) return <p className="muted">{t('changelog.empty')}</p>

  const { releases } = state
  const newer = running ? releases.filter(r => compareVersions(r.version, running) === 1).length : 0
  const installed = running ? releases.findIndex(r => compareVersions(r.version, running) === 0) : -1
  const split = Math.max(SHOWN, newer, installed + 1)
  return (
    <div className="releases">
      <ol>
        {releases.slice(0, split).map(release => <li key={release.tag}><Release release={release} running={running} /></li>)}
      </ol>
      {releases.length > split && (
        <details className="group">
          <summary className="setting-link">{t('changelog.older', releases.length - split)}</summary>
          <ol>
            {releases.slice(split).map(release => <li key={release.tag}><Release release={release} running={running} /></li>)}
          </ol>
        </details>
      )}
    </div>
  )
}

function Release({ release, running }: { release: ReleaseDto; running?: string | null }) {
  const t = useT()
  const formatDate = useFormatDate()
  const blocks = useMemo(() => parseReleaseNotes(release.notes, { repo: MAGNETAR_REPO }), [release.notes])
  const order = running ? compareVersions(release.version, running) : null
  const title = release.name && release.name !== release.tag ? release.name : `Magnetar ${release.version}`
  return (
    <article className="release" aria-label={title}>
      <header>
        <h3>{title}</h3>
        {order === 0 && <Tag tone="ok">{t('changelog.installed')}</Tag>}
        {order === 1 && !release.prerelease && <Tag tone="accent">{t('changelog.new')}</Tag>}
        {release.prerelease && <Tag tone="warn">{t('changelog.prerelease')}</Tag>}
        {release.publishedAt && <time className="fine" dateTime={release.publishedAt}>{formatDate(release.publishedAt)}</time>}
      </header>
      {blocks.length ? <ReleaseNotes notes={blocks} classes={NOTES_CLASSES} /> : <p className="muted">{t('changelog.noNotes')}</p>}
      <a className="setting-link fine" href={release.url} target="_blank" rel="noreferrer noopener">
        <ExternalLink size={13} aria-hidden className="mr-1.5" />{t('changelog.onGitHub')}
      </a>
    </article>
  )
}

/** The app's look for release notes. */
const NOTES_CLASSES: ReleaseNotesClasses = {
  root: 'flex flex-col gap-2',
  heading: 'mt-1 font-semibold',
  paragraph: 'break-words',
  list: 'flex flex-col gap-1 pl-5 list-disc',
  orderedList: 'flex flex-col gap-1 pl-5 list-decimal',
  item: 'break-words',
  code: 'overflow-x-auto rounded-ctl bg-raised p-3 font-mono text-[13px]',
  inlineCode: 'rounded bg-raised px-1 font-mono text-[0.85em]',
  link: 'underline underline-offset-4',
}
