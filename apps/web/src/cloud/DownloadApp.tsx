import type { ReleaseArch, ReleaseAssetDto, ReleasePlatform } from '@magnetar/protocol/cloud'
import { formatBytes } from '@magnetar/protocol/bytes'
import { useEffect, useState, type ReactNode } from 'react'
import { formatters, useLanguage, useT } from '../lib/i18n.tsx'
import { Loading } from '../ui/Loading.tsx'
import { latestRelease } from '../lib/releases.ts'
import { RELEASES_PAGE } from '../lib/updates.ts'
import { PLATFORM_NAMES } from './computerLine.ts'


interface Visitor {
  platform: ReleasePlatform | null
  arch: ReleaseArch | null
}

/** The visitor's system, as far as the browser tells; Apple silicon unless a Mac says otherwise. */
async function detectVisitor(): Promise<Visitor> {
  const hints = (navigator as { userAgentData?: { getHighEntropyValues: (h: string[]) => Promise<{ platform?: string; architecture?: string }> } }).userAgentData
  const ua = navigator.userAgent
  let platform: ReleasePlatform | null = /Mac OS X|Macintosh/.test(ua) ? 'macos' : /Windows/.test(ua) ? 'windows' : /Linux|X11/.test(ua) && !/Android/.test(ua) ? 'linux' : null
  if (/iPhone|iPad|Android/.test(ua) || (platform === 'macos' && navigator.maxTouchPoints > 1)) platform = null
  let arch: ReleaseArch | null = /arm|aarch64/i.test(ua) ? 'arm64' : null
  if (hints) {
    try {
      const values = await hints.getHighEntropyValues(['architecture'])
      if (values.architecture) arch = values.architecture.startsWith('arm') ? 'arm64' : 'x64'
    } catch {
      // Not allowed here; keep the guess.
    }
  }
  if (!arch) arch = platform === 'macos' ? 'arm64' : 'x64'
  return { platform, arch }
}

const ARCH_NAMES: Record<ReleasePlatform, Record<ReleaseArch, string>> = {
  macos: { arm64: 'Apple silicon', x64: 'Intel' },
  windows: { arm64: 'ARM', x64: 'x64' },
  linux: { arm64: 'ARM64', x64: 'x64' },
}

/** One asset per system: the .zip for macOS rather than the bare executable. */
function pick(assets: ReleaseAssetDto[], platform: ReleasePlatform, arch: ReleaseArch): ReleaseAssetDto | undefined {
  const matching = assets.filter(a => a.platform === platform && a.arch === arch)
  return matching.find(a => a.name.endsWith('.zip')) ?? matching[0]
}

/** The visitor's system and the newest release's file for it. */
function useAppDownload() {
  const release = latestRelease.useLatest()
  const [visitor, setVisitor] = useState<Visitor>({ platform: null, arch: null })
  useEffect(() => void detectVisitor().then(setVisitor), [])
  const main = release && visitor.platform && visitor.arch ? pick(release.assets, visitor.platform, visitor.arch) : undefined
  return { release, platform: visitor.platform, main }
}

/**
 * The first page's one button: the app for the visitor's system, or the releases page where the system is not one
 * the app runs on (a phone) or GitHub can't be asked. The line under it names the other systems.
 */
export function useGetApp(className: string): { button: ReactNode; note: string } {
  const t = useT()
  const language = useLanguage()
  const { release, platform, main } = useAppDownload()
  const others = (['macos', 'windows', 'linux'] as const).filter(p => p !== platform).map(p => PLATFORM_NAMES[p])
  return {
    button: main && platform
      ? <a className={className} href={main.url}>{t('get.for', PLATFORM_NAMES[platform])}</a>
      : <a className={className} href={release?.pageUrl ?? RELEASES_PAGE} target="_blank" rel="noreferrer noopener">{t('devices.download')}</a>,
    note: platform ? t('home.free', formatters(language).list(others)) : t('get.onComputer'),
  }
}

/**
 * Gets the app onto the visitor's computer: one button for their system, the others under it, and
 * what to do on first launch. Falls back to the releases page if GitHub can't be asked.
 */
export function DownloadApp() {
  const t = useT()
  const { release, platform, main } = useAppDownload()
  const others = release ? (['macos', 'windows', 'linux'] as const).flatMap(platform => (['arm64', 'x64'] as const).map(arch => ({ platform, arch, asset: pick(release.assets, platform, arch) })))
    .filter(o => o.asset && o.asset !== main) : []

  if (release === undefined) return <Loading />
  return (
    <div className="get-app">
      {main && platform ? (
        <a className="infall-button" href={main.url}>
          <span className="get-app-label">
            <span>{t('get.for', PLATFORM_NAMES[platform])}</span>
            <small>{ARCH_NAMES[platform][main.arch]}, v{release!.version}, {formatBytes(main.size)}</small>
          </span>
        </a>
      ) : (
        <a className="infall-button" href={release?.pageUrl ?? RELEASES_PAGE} target="_blank" rel="noreferrer noopener">
          {release ? t('get.version', release.version) : t('devices.download')}
        </a>
      )}
      {platform && main && <p className="fine">{t(`get.first.${platform}`)}</p>}
      {!platform && release && <p className="fine">{t('get.onComputer')}</p>}
      {others.length > 0 && (
        <details className="get-app-others">
          <summary>{t('get.others')}</summary>
          <ul>
            {others.map(({ platform, arch, asset }) => (
              <li key={asset!.name}>
                <a href={asset!.url}><span>{PLATFORM_NAMES[platform]}, {ARCH_NAMES[platform][arch]}</span><span className="fine">{formatBytes(asset!.size)}</span></a>
              </li>
            ))}
            <li><a href={release?.pageUrl ?? RELEASES_PAGE} target="_blank" rel="noreferrer noopener">{t('get.releaseNotes')}</a></li>
          </ul>
        </details>
      )}
    </div>
  )
}

/**
 * Opens Magnetar on this computer at Connect to your account, through the app's own magnetar://connect link.
 * The website cannot tell whether the app is there, so after the click it says what should happen and what to
 * do if nothing does. Not shown on a phone, where the app does not run.
 */
export function ConnectThisComputer({ className }: { className: string }) {
  const t = useT()
  const { platform } = useAppDownload()
  const [asked, setAsked] = useState(false)
  if (!platform) return null
  return (
    <>
      <a className={className} href="magnetar://connect" onClick={() => setAsked(true)}>{t('connect.button')}</a>
      <p className="fine connect-note" role="status">{asked ? t('connect.opening') : ''}</p>
    </>
  )
}
