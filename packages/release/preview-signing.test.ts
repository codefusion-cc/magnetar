import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { generateKeyPair } from './release-key.ts'

// Magnetar Preview signs its updates with its own key, readable only from main, and trusts only that key: a preview
// build's key can never sign an update the released app installs.
const repo = join(import.meta.dirname, '../..')
const read = (path: string) => readFileSync(join(repo, path), 'utf8').replaceAll('\r\n', '\n')
const workflow = read('.github/workflows/preview-app.yml')
const publish = workflow.slice(workflow.indexOf('\n  publish:'))

describe('Magnetar Preview signing', () => {
  it('publishes from the main-only preview-signing environment with PREVIEW_SIGNING_KEY', () => {
    expect(publish).toMatch(/\n    environment: preview-signing\n/)
    expect(publish).toContain('RELEASE_SIGNING_KEY: ${{ secrets.PREVIEW_SIGNING_KEY }}')
  })

  it('never reads the release signing key', () => {
    expect(workflow).not.toContain('secrets.RELEASE_SIGNING_KEY')
  })

  it('trusts a key of its own, not the release key', () => {
    const preview = read('apps/client/preview-public-key.txt').trim()
    expect(Buffer.from(preview, 'base64url')).toHaveLength(32)
    expect(preview).not.toBe(read('apps/client/release-public-key.txt').trim())
  })

  it('builds Magnetar Preview with preview-public-key.txt', () => {
    const build = read('apps/client/build.rs')
    expect(build).toContain('if std::env::var_os("MAGNETAR_PREVIEW").is_some() { "preview-public-key.txt" } else { "release-public-key.txt" }')
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
