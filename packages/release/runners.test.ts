import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// docs/RUNNERS.md: the jobs that move into the monorepo take the pool's runner; GitHub's own labels stay only where
// the Rust client and its releases need macOS, Windows or an old Ubuntu.
const workflows = join(import.meta.dirname, '../../.github/workflows')
const POOL = /^\$\{\{ vars\.CI_RUNNER_(LIGHT|HEAVY) \}\}$/
const GITHUB_LABEL = /\b(ubuntu|macos|windows)-[\w.-]+/
/** The lines that may name one of GitHub's labels, by workflow. */
const staying: Record<string, RegExp> = {
  'release.yml': /./,
  'provider-health.yml': /./,
  // Magnetar Preview is a macOS app, signed on macOS.
  'preview-app.yml': /^\s+runs-on: macos-14$/,
  // The check jobs keep the names the ruleset requires; only macOS and Windows run on GitHub's machines.
  'ci.yml': /^\s+- \{ check: [\w.-]+, runner: ((macos|windows)-[\w.-]+|'\$\{\{ vars\.CI_RUNNER_HEAVY \}\}') \}$/,
}

const files = readdirSync(workflows).filter(name => name.endsWith('.yml'))
// Git may check the files out with CRLF line ends (Windows).
const read = (name: string) => readFileSync(join(workflows, name), 'utf8').replaceAll('\r\n', '\n')

describe('CI runners', () => {
  it.each(files)('%s names none of GitHub\'s labels outside the jobs that stay', name => {
    const lines = read(name).split('\n')
    const labelled = lines.filter(line => !line.trimStart().startsWith('#') && GITHUB_LABEL.test(line))
    expect(labelled.filter(line => !staying[name]?.test(line))).toEqual([])
  })

  it.each(files.filter(name => !(name in staying) || name === 'ci.yml'))('every job of %s takes the pool\'s runner or a matrix one', name => {
    const runsOn = [...read(name).matchAll(/^\s+runs-on: (.+)$/gm)].map(m => m[1]!.trim())
    expect(runsOn.length).toBeGreaterThan(0)
    for (const runner of runsOn) expect(runner, name).toMatch(runner.includes('matrix') ? /^\$\{\{ matrix\.runner \}\}$/ : POOL)
  })

  it("the Linux check takes the pool's heavy runner", () => {
    expect(read('ci.yml')).toContain("- { check: ubuntu-latest, runner: '${{ vars.CI_RUNNER_HEAVY }}' }")
  })
})
