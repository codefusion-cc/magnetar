import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { generateKeyPair } from './release-key.ts'

// Magnetar and Magnetar Preview each sign their updates with a key of their own, readable only from main, and each
// trusts only its own: a preview build's key can never sign an update the released app installs.
const repo = join(import.meta.dirname, '../..')
const read = (path: string) => readFileSync(join(repo, path), 'utf8').replaceAll('\r\n', '\n')
const workflow = read('.github/workflows/preview-app.yml')
const publish = workflow.slice(workflow.indexOf('\n  publish:'))

const SIGNING_KEYS: Record<string, string> = { RELEASE_SIGNING_KEY: 'release-signing', PREVIEW_SIGNING_KEY: 'preview-signing' }
const workflows = readdirSync(join(repo, '.github/workflows')).filter((name) => name.endsWith('.yml'))
/** A workflow's jobs, each from its name to the next one's. */
const jobsOf = (text: string) => text.slice(text.indexOf('\njobs:\n')).split(/\n(?=  [\w-]+:\n)/).slice(1)
const secretsOf = (text: string) => [...text.matchAll(/secrets(?:\.(\w+)|\[\s*['"](\w+)['"]\s*\])/g)].map((m) => m[1] ?? m[2] ?? '')

describe('signing keys', () => {
  it.each(workflows)('%s reads a signing key only in its main-only environment', (name) => {
    for (const job of jobsOf(read(`.github/workflows/${name}`))) {
      for (const secret of secretsOf(job).filter((secret) => secret in SIGNING_KEYS)) {
        expect(job, `${name}: ${secret}`).toMatch(new RegExp(`\n    environment: ${SIGNING_KEYS[secret]}\n`))
      }
    }
  })

  it('releases are signed in release-signing, checked against release-public-key.txt', () => {
    const release = read('.github/workflows/release.yml')
    const job = jobsOf(release).find((job) => job.startsWith('  publish:'))!
    expect(job).toMatch(/\n    environment: release-signing\n/)
    expect(job).toContain('RELEASE_SIGNING_KEY: ${{ secrets.RELEASE_SIGNING_KEY }}')
    expect(job).toContain('node packages/release/sign-release.ts assets\n')
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
  it('publishes from the main-only preview-signing environment with PREVIEW_SIGNING_KEY', () => {
    expect(publish).toMatch(/\n    environment: preview-signing\n/)
    expect(publish).toContain('RELEASE_SIGNING_KEY: ${{ secrets.PREVIEW_SIGNING_KEY }}')
  })

  it('never reads the release signing key', () => {
    const secrets = secretsOf(workflow)
    expect(secrets).toContain('PREVIEW_SIGNING_KEY')
    expect(secrets).not.toContain('RELEASE_SIGNING_KEY')
  })

  it('checks the signature against preview-public-key.txt before publishing', () => {
    expect(publish).toContain('node packages/release/sign-release.ts assets --public-key apps/client/preview-public-key.txt')
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
