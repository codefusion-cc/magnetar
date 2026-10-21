/**
 * Signs a release manifest: node packages/release/sign-release.ts <dir-with-SHA256SUMS.txt> [--public-key <file>]
 * Reads the private key from RELEASE_SIGNING_KEY and writes SHA256SUMS.txt.sig next to it, once the signature checks
 * out against the public key the app compiles in (apps/client/release-public-key.txt unless given): a wrong secret
 * fails here instead of publishing a release every install refuses.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { 'public-key': { type: 'string', default: join(import.meta.dirname, '..', '..', 'apps', 'client', 'release-public-key.txt') } },
})
const dir = positionals[0] ?? '.'
const publicKeyFile = values['public-key']!
const secret = process.env.RELEASE_SIGNING_KEY
if (!secret) throw new Error('RELEASE_SIGNING_KEY is not set')
const key = await crypto.subtle.importKey('pkcs8', Buffer.from(secret.trim(), 'base64url'), 'Ed25519', false, ['sign'])
const publicKey = await crypto.subtle.importKey('raw', Buffer.from(readFileSync(publicKeyFile, 'utf8').trim(), 'base64url'), 'Ed25519', false, ['verify'])
const manifest = readFileSync(join(dir, 'SHA256SUMS.txt'))
const signature = new Uint8Array(await crypto.subtle.sign('Ed25519', key, manifest))
if (!(await crypto.subtle.verify('Ed25519', publicKey, signature, manifest))) {
  throw new Error(`RELEASE_SIGNING_KEY is not the private half of ${publicKeyFile}: installs would refuse this release`)
}
writeFileSync(join(dir, 'SHA256SUMS.txt.sig'), Buffer.from(signature).toString('base64url') + '\n')
console.log('Signed SHA256SUMS.txt')
