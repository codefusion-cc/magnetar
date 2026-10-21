import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { changesShippedApp, latestVersion, nextVersion, parseTag, plan, previewVersion } from './release-version.ts'

const MONOREPO = { prefix: 'magnetar-v', folder: 'apps/magnetar' }

describe('previewVersion', () => {
  it('is the next release with the build number, before that release and after the last one', () => {
    expect(previewVersion(['v1.2.7', 'v1.2.8'], 412)).toBe('1.2.9-preview.412')
    expect(previewVersion(['v1.2.8', 'v1.2.9-preview.411', 'v1.3.0-rc.1'], 412)).toBe('1.2.9-preview.412')
    expect(previewVersion(['magnetar-v2.0.0'], 1, 'magnetar-v')).toBe('2.0.1-preview.1')
  })
  it('has none before the first release', () => {
    expect(previewVersion([], 5)).toBeNull()
  })
  it('refuses a build number that is not a positive whole number', () => {
    for (const build of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) expect(() => previewVersion(['v1.0.0'], build)).toThrow(/Invalid build/)
  })
})

describe('nextVersion', () => {
  it('adds one patch to the latest tag', () => {
    expect(nextVersion(['v1.0.0', 'v1.1.0', 'v1.2.1'])).toBe('1.2.2')
  })
  it('has none before the first release, which is tagged by hand', () => {
    expect(nextVersion([])).toBeNull()
    expect(nextVersion(['not-a-release', 'v1.3.0-rc.1'])).toBeNull()
  })
  it('continues from a minor release tagged by hand', () => {
    expect(nextVersion(['v1.2.0', 'v1.2.7', 'v1.3.0'])).toBe('1.3.1')
    expect(nextVersion(['v1.9.9', 'v2.0.0'])).toBe('2.0.1')
  })
  it('compares numerically, not as text', () => {
    expect(latestVersion(['v1.9.0', 'v1.10.0', 'v1.2.30'])).toEqual([1, 10, 0])
    expect(nextVersion(['v1.2.9', 'v1.2.10'])).toBe('1.2.11')
  })
  it('ignores pre-release and other tags', () => {
    expect(nextVersion(['v1.2.0', 'v1.3.0-rc.1', 'v2.0.0-beta', 'latest', '1.9.0', 'v1.2.0.1'])).toBe('1.2.1')
    expect(parseTag('v1.3.0-rc.1')).toBeNull()
  })
})

describe('changesShippedApp', () => {
  it('skips docs, tests and CI', () => {
    expect(changesShippedApp(['docs/MAP.md', 'README.md', '.github/workflows/ci.yml', 'apps/e2e/tests/a.e2e.ts', 'apps/client/tests/x.rs', 'apps/worker/test/relay.test.ts', 'apps/web/src/lib/a.test.ts', 'apps/web/CHANGELOG.md'])).toBe(false)
    expect(changesShippedApp([])).toBe(false)
  })
  it('counts anything that ships', () => {
    expect(changesShippedApp(['docs/MAP.md', 'apps/client/src/rpc.rs'])).toBe(true)
    expect(changesShippedApp(['apps/web/src/i18n/en.json'])).toBe(true)
    expect(changesShippedApp(['Cargo.lock'])).toBe(true)
    expect(changesShippedApp(['apps/worker/migrations/0006_x.sql'])).toBe(true)
  })
})

describe('plan', () => {
  const tags = ['v1.2.0', 'v1.2.1']
  it('releases the next patch when the app changed', () => {
    expect(plan({ tags, changed: ['apps/client/src/rpc.rs'] })).toMatchObject({ release: true, tag: 'v1.2.2' })
  })
  it('does not release docs-only changes', () => {
    expect(plan({ tags, changed: ['docs/MAP.md', '.github/workflows/ci.yml'] })).toMatchObject({ release: false, tag: '' })
  })
  it('does not release a commit the latest tag already contains', () => {
    expect(plan({ tags, containedInLatest: true, changed: ['apps/client/src/rpc.rs'] }).release).toBe(false)
  })
  it('releases nothing until the first one is run by hand', () => {
    expect(plan({ tags: [], changed: ['apps/client/src/rpc.rs'] })).toEqual({ release: false, tag: '', reason: 'no release tag yet: the first one is run by hand' })
    expect(plan({ tags: [], explicitTag: 'v0.1.0' })).toMatchObject({ release: true, tag: 'v0.1.0' })
  })
  it('publishes a version given by hand as it is', () => {
    expect(plan({ tags, explicitTag: 'v1.3.0', changed: [] })).toMatchObject({ release: true, tag: 'v1.3.0' })
  })
  it('holds an app change while the hold file exists, and says why', () => {
    const held = plan({ tags, changed: ['apps/web/src/a.ts'], held: 'Infall redesign\n' })
    expect(held).toEqual({ release: false, tag: '', reason: 'held by .github/release-hold: Infall redesign' })
    expect(plan({ tags, changed: ['apps/web/src/a.ts'], held: '' }).reason).toBe('held by .github/release-hold: no reason given')
  })
  it('lets a version given by hand through a hold', () => {
    expect(plan({ tags, explicitTag: 'v1.3.0', changed: ['apps/web/src/a.ts'], held: 'x' })).toMatchObject({ release: true, tag: 'v1.3.0' })
  })
  it('never holds the first release, one given by hand', () => {
    expect(plan({ tags: [], explicitTag: 'v0.1.0', held: 'x' })).toMatchObject({ release: true, tag: 'v0.1.0' })
  })
})

describe('as the monorepo tags it', () => {
  it('reads only its own prefix', () => {
    expect(parseTag('magnetar-v1.2.3', 'magnetar-v')).toEqual([1, 2, 3])
    for (const tag of ['v1.2.3', 'magnetar-1.2.3', 'magnetar-v1.2', 'xmagnetar-v1.2.3', 'magnetar-v1.2.3-rc.1']) expect(parseTag(tag, 'magnetar-v'), tag).toBeNull()
    expect(parseTag('magnetar-v1.2.3')).toBeNull()
    expect(nextVersion(['v9.0.0', 'magnetar-v1.2.3', 'neko-v5.0.0'], 'magnetar-v')).toBe('1.2.4')
  })
  it("counts only changes in the app's folder", () => {
    expect(changesShippedApp(['apps/neko/src/a.ts', 'packages/x/src/a.ts', 'apps/magnetarx/a.ts'], 'apps/magnetar')).toBe(false)
    expect(changesShippedApp(['apps/magnetar/docs/MAP.md', 'apps/magnetar/apps/worker/test/a.test.ts', 'apps/magnetar'], 'apps/magnetar')).toBe(false)
    expect(changesShippedApp(['apps/magnetar/apps/client/src/rpc.rs'], 'apps/magnetar/')).toBe(true)
    expect(changesShippedApp(['docs/MAP.md', 'apps/client/src/rpc.rs'])).toBe(true)
  })
  it('names its tags, its hold file and the release before with the prefix', () => {
    const tags = ['v9.9.9', 'magnetar-v1.2.0']
    expect(plan({ tags, changed: ['apps/magnetar/apps/web/src/a.ts'] }, MONOREPO)).toEqual({ release: true, tag: 'magnetar-v1.2.1', reason: 'the app changed since magnetar-v1.2.0' })
    expect(plan({ tags, changed: ['apps/neko/src/a.ts'] }, MONOREPO).reason).toBe('only docs, tests or CI changed since magnetar-v1.2.0')
    expect(plan({ tags, changed: ['apps/magnetar/apps/web/src/a.ts'], held: 'x' }, MONOREPO).reason).toBe('held by apps/magnetar/.github/release-hold: x')
    expect(plan({ tags: ['v1.2.0'] }, MONOREPO).release).toBe(false)
  })
})

describe('in a repository', () => {
  const run = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', ...args], { cwd, encoding: 'utf8' }).trim()
  const script = join(import.meta.dirname, 'release-version.ts')
  const plan = (cwd: string, ...args: string[]) => execFileSync('node', [script, ...args], { cwd, encoding: 'utf8' }).trim()
  function commit(cwd: string, file: string) {
    mkdirSync(join(cwd, file, '..'), { recursive: true })
    writeFileSync(join(cwd, file), String(Math.random()))
    run(cwd, 'add', '-A')
    run(cwd, 'commit', '-m', file)
  }

  it('follows the tags and the paths changed since the latest one', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'release-version-'))
    run(cwd, 'init', '-q', '-b', 'main')
    commit(cwd, 'apps/client/src/main.rs')
    expect(plan(cwd, 'plan')).toContain('release=false')
    expect(plan(cwd, 'display')).toBe('')
    expect(plan(cwd, 'plan', '--tag', 'v1.2.0')).toContain('tag=v1.2.0')
    run(cwd, 'tag', 'v1.2.0')
    expect(plan(cwd, 'plan')).toContain('release=false')
    commit(cwd, 'docs/a.md')
    expect(plan(cwd, 'plan')).toContain('release=false')
    expect(plan(cwd, 'display')).toBe('1.2.0')
    commit(cwd, 'apps/web/src/a.ts')
    expect(plan(cwd, 'plan')).toContain('tag=v1.2.1')
    expect(plan(cwd, 'display')).toBe('1.2.1')
    run(cwd, 'tag', 'v1.2.1')
    run(cwd, 'tag', 'v1.3.0-rc.1')
    commit(cwd, 'apps/web/src/b.ts')
    expect(plan(cwd, 'plan')).toContain('tag=v1.2.2')
    run(cwd, 'tag', 'v1.3.0')
    commit(cwd, 'apps/web/src/c.ts')
    expect(plan(cwd, 'plan')).toContain('tag=v1.3.1')
    // A queued older merge is already inside the newer release.
    expect(plan(cwd, 'plan', '--sha', 'HEAD~1')).toContain('release=false')
    // A hold collects app changes until the merge that deletes it releases them all.
    mkdirSync(join(cwd, '.github'), { recursive: true })
    writeFileSync(join(cwd, '.github/release-hold'), 'Infall redesign')
    run(cwd, 'add', '-A')
    run(cwd, 'commit', '-m', 'hold')
    const since = run(cwd, 'rev-parse', '--short', 'HEAD')
    expect(plan(cwd, 'plan')).toBe(`release=false tag= version= (held by .github/release-hold since ${since}, 2 merges waiting: Infall redesign)`)
    expect(plan(cwd, 'display')).toBe('1.3.0')
    commit(cwd, 'apps/web/src/d.ts')
    expect(plan(cwd, 'plan')).toContain(`since ${since}, 3 merges waiting`)
    run(cwd, 'rm', '-q', '.github/release-hold')
    run(cwd, 'commit', '-m', 'release')
    expect(plan(cwd, 'plan')).toContain('tag=v1.3.1')
    // An older commit read by its sha is judged by its own tree: still held.
    expect(plan(cwd, 'plan', '--sha', 'HEAD~1')).toContain('release=false')
    // The monorepo's form beside it: its own tags, only its folder, the version without the prefix.
    const mono = ['--prefix', 'magnetar-v', '--folder', 'apps/magnetar']
    expect(plan(cwd, 'plan', ...mono)).toContain('release=false')
    run(cwd, 'tag', 'magnetar-v2.0.0')
    commit(cwd, 'apps/web/src/e.ts')
    expect(plan(cwd, 'plan', ...mono)).toContain('release=false')
    expect(plan(cwd, 'display', ...mono)).toBe('2.0.0')
    commit(cwd, 'apps/magnetar/apps/web/src/a.ts')
    expect(plan(cwd, 'plan', ...mono)).toMatch(/^release=true tag=magnetar-v2\.0\.1 version=2\.0\.1 /)
    expect(plan(cwd, 'display', ...mono)).toBe('2.0.1')
    expect(plan(cwd, 'plan')).toContain('tag=v1.3.1')
    // About thirty git and node processes: Windows runners need seconds for them, more than Vitest's default five.
  }, 30_000)
})
