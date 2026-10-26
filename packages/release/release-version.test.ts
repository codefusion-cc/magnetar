import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { changesShippedApp, checkExplicitTag, latestVersion, nextVersion, parseTag, plan, previewVersion } from './release-version.ts'

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
  it("ignores tags with leading zeros, which the app's updater can't read", () => {
    for (const tag of ['v01.2.3', 'v1.02.3', 'v1.2.03', 'v00.0.0', 'v1.2.9999999999999999']) expect(parseTag(tag), tag).toBeNull()
    expect(nextVersion(['v1.2.0', 'v1.3.00'])).toBe('1.2.1')
    expect(parseTag('v0.0.0')).toEqual([0, 0, 0])
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
  it('publishes a version given by hand as it is, with or without app changes', () => {
    expect(plan({ tags, explicitTag: 'v1.3.0', changed: [] })).toEqual({ release: true, tag: 'v1.3.0', reason: 'version given by hand' })
    expect(plan({ tags, explicitTag: 'v1.3.0', containedInLatest: true })).toMatchObject({ release: true, tag: 'v1.3.0' })
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

describe('checkExplicitTag', () => {
  const tags = ['v1.2.0', 'v1.2.1', 'v1.3.0-rc.1', 'v1.2.2-preview.40']
  const sha = 'a'.repeat(40)
  const check = (tag: string, at: string | null = null, prefix = 'v', list: readonly string[] = tags) => () => checkExplicitTag(tag, list, prefix, at, sha)

  it('takes a release or a pre-release above the latest release', () => {
    for (const tag of ['v1.2.2', 'v1.3.0', 'v2.0.0', 'v1.10.0', 'v1.3.0-rc.2', 'v1.2.2-beta', 'v1.2.2-rc.1.2', 'v10.0.0-0', 'v1.3.0-0a', 'v1.3.0-rc.10', 'v1.3.0-01a', 'v1.2.999999999999998', 'v999999999999999.999999999999999.0']) expect(check(tag), tag).not.toThrow()
  })
  it('takes the first release when there is none', () => {
    expect(check('v0.0.1', null, 'v', [])).not.toThrow()
    expect(check('v0.1.0', null, 'v', ['latest', 'v1.0.0-rc.1'])).not.toThrow()
  })
  it('refuses the latest release, anything below it and pre-releases of either', () => {
    for (const tag of ['v1.2.1', 'v1.2.0', 'v1.1.9', 'v0.9.0', 'v1.2.1-rc.1', 'v1.2.0-beta']) expect(check(tag), tag).toThrow('is not above the latest release, v1.2.1')
  })
  it('compares numerically, not as text', () => {
    expect(check('v1.9.0', null, 'v', ['v1.10.0'])).toThrow(/not above/)
    expect(check('v1.10.0', null, 'v', ['v1.9.0'])).not.toThrow()
  })
  it('refuses a version whose next patch could not be read', () => {
    expect(check('v1.2.999999999999999')).toThrow('the patch after it would not be a version')
  })
  it("refuses Magnetar Preview's versions", () => {
    for (const tag of ['v1.2.2-preview.41', 'v1.3.0-preview.1', 'v2.0.0-preview.x']) expect(check(tag), tag).toThrow('is a Magnetar Preview version')
    expect(check('v1.3.0-previews.1')).not.toThrow()
  })
  it('refuses anything that is not a version tag', () => {
    const bad = ['', 'v', '1.3.0', 'v1.3', 'v1.3.0.1', 'v1.3.0-', 'v1.3.0-rc..1', 'v1.3.0-rc.', 'v1.3.0+build.1', ' v1.3.0', 'v1.3.0 ',
      'v1.3.0\n', 'v1.3.0-rc_1', 'v1.3.0-rc.1;rm -rf /', 'v1.3.0/x', '../v1.3.0', 'V1.3.0', 'v\uff11.3.0', 'v1.3.0-\u00e9', `v1.3.0-${'a.'.repeat(5000)}`,
      'refs/tags/v1.3.0', '-v1.3.0', 'v-1.3.0',
      // Semantic Versioning has no leading zeros, and the app's updater skips a tag that has them.
      'v01.3.0', 'v1.03.0', 'v1.3.00', 'v1.3.0-rc.01', 'v1.3.0-00',
      // Past what a JavaScript number holds exactly, every later patch would be the same unparseable version.
      'v1.2.9999999999999999', 'v1.2.99999999999999999999', 'v9999999999999999.0.0']
    for (const tag of bad) expect(check(tag), JSON.stringify(tag)).toThrow('is not a version tag like v1.3.0 or v1.3.0-rc.1')
  })
  it('takes a tag that exists only on the commit it points at', () => {
    expect(check('v1.2.1', sha)).not.toThrow()
    expect(check('v1.3.0-rc.1', sha)).not.toThrow()
    expect(check('v1.2.1', 'b'.repeat(40))).toThrow(`v1.2.1 exists already at bbbbbbb, not at aaaaaaa`)
    expect(check('v1.2.1', '')).toThrow(/exists already/)
    // Even on this commit, an existing tag below the latest release, or a pre-release of it, is never released again.
    expect(check('v1.2.0', sha)).toThrow('v1.2.0 is not above the latest release, v1.2.1')
    expect(check('v1.2.1-rc.1', sha)).toThrow('is not above the latest release')
    expect(check('v1.2.1', null)).toThrow('is not above the latest release')
  })
  it('reads only its own prefix in the monorepo', () => {
    const mono = ['magnetar-v1.2.0', 'v9.0.0']
    expect(check('magnetar-v1.2.1', null, 'magnetar-v', mono)).not.toThrow()
    expect(check('magnetar-v1.2.0', null, 'magnetar-v', mono)).toThrow('is not above the latest release, magnetar-v1.2.0')
    expect(check('v1.3.0', null, 'magnetar-v', mono)).toThrow('is not a version tag like magnetar-v1.3.0')
  })
  it('takes exactly the versions above the latest, for any versions', () => {
    const version = fc.tuple(fc.nat(50), fc.nat(50), fc.nat(50))
    fc.assert(fc.property(fc.array(version, { maxLength: 5 }), version, fc.option(fc.stringMatching(/^[0-9A-Za-z]{1,8}(\.[0-9A-Za-z]{1,8}){0,2}$/), { nil: undefined }), (released, chosen, pre) => {
      const tag = `v${chosen.join('.')}${pre ? `-${pre}` : ''}`
      const above = released.every(([major, minor, patch]) => (chosen[0] - major || chosen[1] - minor || chosen[2] - patch) > 0)
      const preview = pre?.startsWith('preview.') ?? false
      const leadingZero = pre?.split('.').some(part => /^0\d+$/.test(part)) ?? false
      const ok = above && !preview && !leadingZero
      let threw = false
      try { checkExplicitTag(tag, released.map(v => `v${v.join('.')}`), 'v', null, sha) } catch { threw = true }
      return threw === !ok
    }))
  })
  it('never takes a string with characters outside a version tag', () => {
    fc.assert(fc.property(fc.string({ unit: 'binary', minLength: 1 }).filter(s => /[^0-9A-Za-z.-]/.test(s)), junk => {
      for (const tag of [`v1.3.0-${junk}`, `v${junk}`, `v1.3.0${junk}`]) {
        try { checkExplicitTag(tag, [], 'v', null, sha); return false } catch { /* refused */ }
      }
      return true
    }))
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
  const plan = (cwd: string, ...args: string[]) => execFileSync('node', [script, ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
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
    // A release cut short after tagging is finished on its own commit, by a short sha too, and on no other.
    expect(plan(cwd, 'plan', '--tag', 'v1.2.0')).toContain('release=true tag=v1.2.0')
    expect(plan(cwd, 'plan', '--tag', 'v1.2.0', '--sha', run(cwd, 'rev-parse', '--short', 'HEAD'))).toContain('tag=v1.2.0')
    expect(plan(cwd, 'plan')).toContain('release=false')
    commit(cwd, 'docs/a.md')
    expect(() => plan(cwd, 'plan', '--tag', 'v1.2.0')).toThrow(/v1\.2\.0 exists already at \w{7}, not at \w{7}/)
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
    // A version given by hand is checked before anything is built.
    expect(() => plan(cwd, 'plan', '--tag', 'v1.2.9')).toThrow('v1.2.9 is not above the latest release, v1.3.0')
    expect(() => plan(cwd, 'plan', '--tag', 'v1.3.1-preview.7')).toThrow('is a Magnetar Preview version')
    expect(plan(cwd, 'plan', '--tag', 'v1.4.0')).toContain('release=true tag=v1.4.0')
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
