/**
 * Which release a merge to main becomes. Used by .github/workflows/release.yml (`plan`) and the Worker deploy in
 * ci.yml (`display`), so the website and the app name the same version for the same code.
 *
 *   node packages/release/release-version.ts plan [--sha <commit>] [--tag <v1.3.0>] [--prefix v] [--folder <path>]
 *   node packages/release/release-version.ts display [--sha <commit>] [--prefix v] [--folder <path>]
 *   node packages/release/release-version.ts preview [--sha <commit>] [--prefix v]
 *
 * Tags are `<prefix>X.Y.Z`: `v1.2.3` here, where installed apps read them, and `magnetar-v1.2.3` in the codefusion
 * monorepo, where the app is the folder `apps/magnetar` (`--folder`): only changes under it count, and its hold file is
 * `<folder>/.github/release-hold`.
 *
 * The version is the latest plain vX.Y.Z tag plus one patch; minor and major releases, and the first one, are the
 * Release workflow run by hand with their version (`--tag`; `checkExplicitTag` says which it takes). No file holds the
 * version: the tag is the version.
 * Pre-release tags (v2.0.0-rc.1) are ignored. A merge that changes only docs, tests or CI files is not released, nor is
 * one while `.github/release-hold` exists: work that ships in parts (a redesign) collects on main and is released by the
 * merge that deletes the file. Its text says why it holds.
 *
 * `preview` names Magnetar Preview's build of a commit on main (.github/workflows/preview-app.yml), whether or not a hold
 * keeps it from a release: the next release's version with `-preview.<the commit's number on main>`, so each merge's
 * build is newer than the one before and older than the release that ships it (1.2.9-preview.412 before 1.2.9).
 */
import { execFileSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { parseArgs } from 'node:util'

export type Version = readonly [major: number, minor: number, patch: number]

/**
 * A version number as Semantic Versioning, and so the app's updater, reads it: no leading zeros. At most 15 digits, so
 * it stays exact as a JavaScript number and the next patch is never a number nobody can tag.
 */
const NUMBER = '(0|[1-9]\\d{0,14})'
const RELEASE = new RegExp(`^${NUMBER}\\.${NUMBER}\\.${NUMBER}$`)
/** A release or a pre-release ("1.3.0-rc.1"), whose numeric parts have no leading zeros either. */
const PART = '(?:0|[1-9]\\d*|\\d*[A-Za-z][0-9A-Za-z]*)'
const VERSION = new RegExp(`^${NUMBER}\\.${NUMBER}\\.${NUMBER}(?:-(${PART}(?:\\.${PART})*))?$`)
/** What Magnetar Preview's pre-releases start with (1.2.9-preview.412). */
const PREVIEW = 'preview.'

/** The version of a plain release tag ("v1.2.3" with the prefix "v"); a pre-release or any other tag is not a release. */
export function parseTag(tag: string, prefix = 'v'): Version | null {
  if (!tag.startsWith(prefix)) return null
  const match = RELEASE.exec(tag.slice(prefix.length))
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null
}

const compare = (a: Version, b: Version) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]
const format = (version: Version) => `${version[0]}.${version[1]}.${version[2]}`

/** The highest release version among the tags, numerically (v1.10.0 is above v1.9.0), or null with none. */
export function latestVersion(tags: readonly string[], prefix = 'v'): Version | null {
  let latest: Version | null = null
  for (const tag of tags) {
    const version = parseTag(tag, prefix)
    if (version && (!latest || compare(version, latest) > 0)) latest = version
  }
  return latest
}

/** The next patch release, "1.2.3" after v1.2.2; null with no release yet, whose first is run by hand. */
export function nextVersion(tags: readonly string[], prefix = 'v'): string | null {
  const latest = latestVersion(tags, prefix)
  return latest ? format([latest[0], latest[1], latest[2] + 1]) : null
}

/** Magnetar Preview's version for the `build`th commit on main; null before the first release. */
export function previewVersion(tags: readonly string[], build: number, prefix = 'v'): string | null {
  if (!Number.isSafeInteger(build) || build < 1) throw new Error(`Invalid build number ${build}`)
  const next = nextVersion(tags, prefix)
  return next && `${next}-${PREVIEW}${build}`
}

/** Files that never reach a user of the app or the website: documentation, tests, CI and repository housekeeping. */
const unshipped = [
  /^docs\//,
  /^\.github\//,
  /^\.claude\//,
  /^apps\/e2e\//,
  /^apps\/worker\/test\//,
  /^apps\/client\/tests\//,
  /(^|\/)[^/]+\.(md|mdx)$/,
  /\.test\.tsx?$/,
  /^(LICENSE|renovate\.json|\.gitignore|\.gitattributes|\.editorconfig)$/,
]

/** Whether any of the changed files (from the repository root) is part of what the app in `folder` ships. */
export function changesShippedApp(paths: readonly string[], folder = ''): boolean {
  const inside = folder ? `${folder.replace(/\/+$/, '')}/` : ''
  return paths.some(path => path.startsWith(inside) && path.length > inside.length && !unshipped.some(pattern => pattern.test(path.slice(inside.length))))
}

/** While this file exists in a commit, that commit is not released (see the top of this file). */
export const HOLD_FILE = '.github/release-hold'

export interface Plan {
  /** Whether this commit becomes a release. */
  release: boolean
  /** The tag to publish ("v1.2.3"); empty when there is no release. */
  tag: string
  reason: string
}

/** How the app's releases are tagged and where it lives: `v` and the repository root here. */
export interface Tagging {
  prefix: string
  folder: string
}

const HERE: Tagging = { prefix: 'v', folder: '' }

/** The hold file of the app in `folder`. */
export const holdFile = (folder: string) => (folder ? `${folder.replace(/\/+$/, '')}/${HOLD_FILE}` : HOLD_FILE)

/**
 * A version given by hand (release.yml's Run workflow on main): a release (v1.3.0) or a pre-release (v1.3.0-rc.1)
 * above the latest release, never one of Magnetar Preview's. A tag that exists already is taken only on the commit it
 * points at and only when it is the latest release or above it, so a release cut short is finished and no other
 * commit's files ever land in it.
 */
export function checkExplicitTag(tag: string, tags: readonly string[], prefix: string, taggedAt: string | null, sha: string): void {
  const match = tag.startsWith(prefix) ? VERSION.exec(tag.slice(prefix.length)) : null
  if (!match) throw new Error(`${JSON.stringify(tag)} is not a version tag like ${prefix}1.3.0 or ${prefix}1.3.0-rc.1`)
  if (match[4]?.startsWith(PREVIEW)) throw new Error(`${tag} is a Magnetar Preview version; preview-app.yml names those`)
  if (taggedAt != null && taggedAt !== sha) throw new Error(`${tag} exists already at ${taggedAt.slice(0, 7)}, not at ${sha.slice(0, 7)}`)
  const latest = latestVersion(tags, prefix)
  const above = latest ? compare([Number(match[1]), Number(match[2]), Number(match[3])], latest) : 1
  // The tag of a release cut short is the latest release itself; any other version has to be above it.
  if (above < 0 || (above === 0 && (taggedAt == null || match[4]))) throw new Error(`${tag} is not above the latest release, ${prefix}${format(latest!)}`)
}

/** What a commit becomes, given the release tags, its relation to the latest one and the files changed since. */
export function plan(input: {
  tags: readonly string[]
  explicitTag?: string
  containedInLatest?: boolean
  changed?: readonly string[]
  held?: string | null
  /** The commit that added the hold, and how many merges since the latest release it holds back. */
  hold?: { since: string; waiting: number }
}, { prefix, folder }: Tagging = HERE): Plan {
  if (input.explicitTag) return { release: true, tag: input.explicitTag, reason: 'version given by hand' }
  const latest = latestVersion(input.tags, prefix)
  if (!latest) return { release: false, tag: '', reason: 'no release tag yet: the first one is run by hand' }
  const latestTag = `${prefix}${format(latest)}`
  if (input.containedInLatest) return { release: false, tag: '', reason: `already part of ${latestTag}` }
  if (input.held != null) {
    const since = input.hold ? ` since ${input.hold.since || 'an unknown commit'}, ${input.hold.waiting} ${input.hold.waiting === 1 ? 'merge' : 'merges'} waiting` : ''
    return { release: false, tag: '', reason: `held by ${holdFile(folder)}${since}: ${input.held.trim() || 'no reason given'}` }
  }
  if (!changesShippedApp(input.changed ?? [], folder)) return { release: false, tag: '', reason: `only docs, tests or CI changed since ${latestTag}` }
  return { release: true, tag: `${prefix}${nextVersion(input.tags, prefix)}`, reason: `the app changed since ${latestTag}` }
}

function git(...args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8' }).trim()
}

/** The latest release tag and what separates `sha` from it, read from the checkout (which needs its tags). */
function fromRepository(sha: string, tagging: Tagging, explicitTag?: string): Plan & { latest: string | null } {
  const tags = git('tag', '--list', `${tagging.prefix}*`).split('\n').filter(Boolean)
  if (explicitTag) checkExplicitTag(explicitTag, tags, tagging.prefix, tags.includes(explicitTag) ? git('rev-list', '-n', '1', explicitTag) : null, sha)
  const latest = latestVersion(tags, tagging.prefix)
  const latestTag = latest ? `${tagging.prefix}${format(latest)}` : null
  const hold = holdFile(tagging.folder)
  let containedInLatest = false
  let changed: string[] = []
  if (latestTag) {
    try {
      git('merge-base', '--is-ancestor', sha, latestTag)
      containedInLatest = true
    } catch {
      changed = git('diff', '--name-only', `${latestTag}...${sha}`).split('\n')
    }
  }
  let held: string | null = null
  try {
    held = execFileSync('git', ['show', `${sha}:${hold}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  } catch {
    // No hold in this commit.
  }
  const holding = held != null && latestTag && !containedInLatest
    ? { since: git('log', '-1', '--format=%h', '--diff-filter=A', sha, '--', hold), waiting: Number(git('rev-list', '--count', '--first-parent', `${latestTag}..${sha}`)) }
    : undefined
  return { ...plan({ tags, explicitTag, containedInLatest, changed, held, hold: holding }, tagging), latest: latestTag }
}

if (process.argv[1] === import.meta.filename) {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { sha: { type: 'string' }, tag: { type: 'string' }, prefix: { type: 'string', default: HERE.prefix }, folder: { type: 'string', default: HERE.folder } },
  })
  const tagging = { prefix: values.prefix, folder: values.folder }
  const sha = git('rev-parse', '--verify', `${values.sha ?? 'HEAD'}^{commit}`)
  if (positionals[0] === 'preview') {
    const tags = git('tag', '--list', `${tagging.prefix}*`).split('\n').filter(Boolean)
    const version = previewVersion(tags, Number(git('rev-list', '--count', '--first-parent', sha)), tagging.prefix)
    if (!version) throw new Error('No release tag yet: the first one is run by hand')
    console.log(version)
    process.exit(0)
  }
  const result = fromRepository(sha, tagging, values.tag)
  const version = (tag: string) => tag.slice(tagging.prefix.length)
  if (positionals[0] === 'plan') {
    const lines = [`release=${result.release}`, `tag=${result.tag}`, `version=${version(result.tag)}`]
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, lines.join('\n') + '\n')
    // On the run's page, so a held release says so where people look for it.
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `**${result.release ? result.tag : 'No release'}**: ${result.reason}.\n`)
    console.log(`${lines.join(' ')} (${result.reason})`)
  } else if (positionals[0] === 'display') {
    // The version the website shows: the one this commit is or is about to be released as.
    console.log(result.release ? version(result.tag) : result.latest ? version(result.latest) : '')
  } else {
    throw new Error('Usage: release-version.ts plan|display|preview [--sha <commit>] [--tag <tag>] [--prefix v] [--folder <path>]')
  }
}
