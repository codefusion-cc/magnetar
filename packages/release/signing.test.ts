import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { generateKeyPair } from './release-key.ts'

// Magnetar and Magnetar Preview each sign their updates with a key of their own, readable only from main, and each
// trusts only its own: a preview build's key can never sign an update the released app installs.
const repo = join(import.meta.dirname, '../..')
const read = (path: string) => readFileSync(join(repo, path), 'utf8').replaceAll('\r\n', '\n')

type Job = { environment?: string | { name?: string }; needs?: string | string[]; uses?: string; secrets?: unknown; steps?: { run?: string; env?: Record<string, string> }[] }
type Workflow = { on?: unknown; jobs?: Record<string, Job> }
const SIGNING_KEYS: Record<string, string> = { RELEASE_SIGNING_KEY: 'release-signing', PREVIEW_SIGNING_KEY: 'preview-signing' }
const SIGNING_ENVIRONMENTS = new Set(Object.values(SIGNING_KEYS))
const workflows = readdirSync(join(repo, '.github/workflows')).filter((name) => /\.ya?ml$/.test(name))
const load = (name: string) => parse(read(`.github/workflows/${name}`)) as Workflow
const environmentOf = (job: Job) => (typeof job.environment === 'string' ? job.environment : job.environment?.name)
/** The secrets an expression names; GitHub matches secret names in any case. */
const secretsOf = (text: string) => [...text.matchAll(/secrets\s*(?:\.\s*(\w+)|\[\s*['"](\w+)['"]\s*\])/gi)].map((m) => (m[1] ?? m[2] ?? '').toUpperCase())
/** Reads that name no secret, so could be any: all of them, or one whose name is computed. */
const opaqueReads = (text: string) => [...text.matchAll(/toJSON\(\s*secrets\s*\)|secrets\s*\[(?!\s*['"]\w+['"]\s*\])/gi)].map((m) => m[0])
/** Only what runs on main's own workflow: a pull request's code or event can't start these. */
const MAIN_ONLY_TRIGGERS = new Set(['workflow_call', 'workflow_dispatch'])
const triggersOf = (on: unknown) => (typeof on === 'string' ? [on] : Array.isArray(on) ? on : Object.keys(on ?? {}))

describe('signing keys', () => {
  it.each(workflows)('%s reads a signing key only in its main-only environment', (name) => {
    const jobs = Object.entries(load(name).jobs ?? {})
    expect(jobs.length, name).toBeGreaterThan(0)
    for (const [id, job] of jobs) {
      const text = JSON.stringify(job)
      expect(opaqueReads(text), `${name} ${id}`).toEqual([])
      for (const secret of secretsOf(text).filter((secret) => secret in SIGNING_KEYS)) {
        expect(environmentOf(job), `${name} ${id}: ${secret}`).toBe(SIGNING_KEYS[secret])
      }
      // Another repository's workflow handed every secret could read a key outside these rules.
      if (job.secrets === 'inherit') expect(job.uses, `${name} ${id}`).toMatch(/^\.\//)
    }
  })

  it.each(workflows)('%s signs only when main starts it', (name) => {
    const workflow = load(name)
    const signing = Object.entries(workflow.jobs ?? {}).filter(([, job]) => SIGNING_ENVIRONMENTS.has(environmentOf(job) ?? ''))
    if (signing.length) expect(triggersOf(workflow.on).filter((trigger) => !MAIN_ONLY_TRIGGERS.has(trigger))).toEqual([])
  })

  it('releases are signed in release-signing, before the tag, by a job that installs nothing', () => {
    const jobs = load('release.yml').jobs!
    expect(environmentOf(jobs.sign!)).toBe('release-signing')
    const steps = jobs.sign!.steps!
    expect(steps.find((step) => step.run?.includes('node packages/release/sign-release.ts assets\n'))?.env).toEqual({
      RELEASE_SIGNING_KEY: '${{ secrets.RELEASE_SIGNING_KEY }}',
    })
    expect(steps.some((step) => /pnpm|npm |npx/.test(step.run ?? ''))).toBe(false)
    expect(jobs.publish!.needs).toContain('sign')
    expect(environmentOf(jobs.publish!)).toBeUndefined()
  })

  it('release-key.ts needs a terminal, and changes nothing without one', () => {
    const before = ['release', 'preview'].map((flavour) => read(`apps/client/${flavour}-public-key.txt`))
    for (const args of [[], ['--preview']]) {
      let error = ''
      try {
        execFileSync(process.execPath, [join(import.meta.dirname, 'release-key.ts'), ...args], { stdio: 'pipe' })
      } catch (thrown) {
        error = String((thrown as { stderr: Buffer }).stderr)
      }
      expect(error).toContain('Run it in a terminal')
    }
    expect(['release', 'preview'].map((flavour) => read(`apps/client/${flavour}-public-key.txt`))).toEqual(before)
  })
})

describe('Magnetar Preview signing', () => {
  const workflow = load('preview-app.yml')
  const publish = workflow.jobs!.publish!

  it('publishes from preview-signing with PREVIEW_SIGNING_KEY, checked against preview-public-key.txt', () => {
    expect(environmentOf(publish)).toBe('preview-signing')
    const sign = publish.steps!.find((step) => step.run?.includes('sign-release.ts'))!
    expect(sign.run).toContain('node packages/release/sign-release.ts assets --public-key apps/client/preview-public-key.txt')
    expect(sign.env).toEqual({ RELEASE_SIGNING_KEY: '${{ secrets.PREVIEW_SIGNING_KEY }}' })
  })

  it('never reads the release signing key', () => {
    const secrets = secretsOf(JSON.stringify(workflow))
    expect(secrets).toContain('PREVIEW_SIGNING_KEY')
    expect(secrets).not.toContain('RELEASE_SIGNING_KEY')
  })

  it('trusts a key of its own, not the release key', () => {
    const preview = read('apps/client/preview-public-key.txt').trim()
    expect(Buffer.from(preview, 'base64url')).toHaveLength(32)
    expect(preview).not.toBe(read('apps/client/release-public-key.txt').trim())
  })
})

describe('a generated key pair', () => {
  it('signs a manifest the public key verifies, as sign-release.ts and the app do', async () => {
    const { publicKey, privateKey } = await generateKeyPair()
    const signer = await crypto.subtle.importKey('pkcs8', Buffer.from(privateKey, 'base64url'), 'Ed25519', false, ['sign'])
    const verifier = await crypto.subtle.importKey('raw', Buffer.from(publicKey, 'base64url'), 'Ed25519', false, ['verify'])
    const manifest = new TextEncoder().encode('abc  Magnetar-1.2.9-preview.92-macos-arm64.zip\n')
    const signature = await crypto.subtle.sign('Ed25519', signer, manifest)
    expect(await crypto.subtle.verify('Ed25519', verifier, signature, manifest)).toBe(true)
    expect(await crypto.subtle.verify('Ed25519', verifier, signature, new TextEncoder().encode('tampered'))).toBe(false)
  })

  it('is new every time', async () => {
    const [a, b] = await Promise.all([generateKeyPair(), generateKeyPair()])
    expect(a.publicKey).not.toBe(b.publicKey)
    expect(a.privateKey).not.toBe(b.privateKey)
  })
})

describe('sign-release.ts', () => {
  const sign = (secret: string, publicKey: string, ...args: string[]) => {
    const dir = mkdtempSync(join(tmpdir(), 'sign-release-'))
    writeFileSync(join(dir, 'SHA256SUMS.txt'), 'abc  Magnetar-1.2.9-preview.92-macos-arm64.zip\n')
    writeFileSync(join(dir, 'public-key.txt'), publicKey + '\n')
    const script = join(import.meta.dirname, 'sign-release.ts')
    try {
      execFileSync(process.execPath, [script, dir, '--public-key', join(dir, 'public-key.txt'), ...args], {
        env: { ...process.env, RELEASE_SIGNING_KEY: secret },
        stdio: 'pipe',
      })
      return { dir, error: '' }
    } catch (error) {
      return { dir, error: String((error as { stderr: Buffer }).stderr) }
    }
  }

  it('signs with the private half of the given public key', async () => {
    const pair = await generateKeyPair()
    const { dir, error } = sign(pair.privateKey, pair.publicKey)
    expect(error).toBe('')
    const verifier = await crypto.subtle.importKey('raw', Buffer.from(pair.publicKey, 'base64url'), 'Ed25519', false, ['verify'])
    const signature = Buffer.from(readFileSync(join(dir, 'SHA256SUMS.txt.sig'), 'utf8').trim(), 'base64url')
    expect(await crypto.subtle.verify('Ed25519', verifier, signature, readFileSync(join(dir, 'SHA256SUMS.txt')))).toBe(true)
  })

  it('refuses a key of another pair, and writes no signature', async () => {
    const [pair, other] = await Promise.all([generateKeyPair(), generateKeyPair()])
    const { dir, error } = sign(other.privateKey, pair.publicKey)
    expect(error).toContain('RELEASE_SIGNING_KEY is not the private half of')
    expect(existsSync(join(dir, 'SHA256SUMS.txt.sig'))).toBe(false)
  })

  it('refuses a missing key', async () => {
    const pair = await generateKeyPair()
    const { dir, error } = sign('', pair.publicKey)
    expect(error).toContain('RELEASE_SIGNING_KEY is not set')
    expect(existsSync(join(dir, 'SHA256SUMS.txt.sig'))).toBe(false)
  })
})
