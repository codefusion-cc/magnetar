/**
 * Generates an Ed25519 key pair that signs release manifests, in a terminal:
 *
 *   node packages/release/release-key.ts [--preview]
 *
 * The private key goes to the clipboard (macOS), never the terminal or a file: paste it as RELEASE_SIGNING_KEY in the
 * main-only environment release-signing, or with `--preview` as PREVIEW_SIGNING_KEY in preview-signing, then press
 * Enter. Only then is the public key written (release-public-key.txt or preview-public-key.txt; commit it) and the
 * clipboard cleared, so stopping before Enter changes nothing. Installed apps only accept updates whose SHA256SUMS.txt
 * is signed by the key their build compiled in.
 */
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { parseArgs } from 'node:util'

export async function generateKeyPair(): Promise<{ publicKey: string; privateKey: string }> {
  const pair = (await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify'])) as CryptoKeyPair
  return {
    publicKey: Buffer.from(await crypto.subtle.exportKey('raw', pair.publicKey)).toString('base64url'),
    privateKey: Buffer.from(await crypto.subtle.exportKey('pkcs8', pair.privateKey)).toString('base64url'),
  }
}

if (import.meta.main) {
  const preview = parseArgs({ options: { preview: { type: 'boolean', default: false } } }).values.preview
  if (!process.stdin.isTTY) throw new Error('Run it in a terminal: it waits while you paste the key')
  const [file, secret, environment] = preview
    ? ['preview-public-key.txt', 'PREVIEW_SIGNING_KEY', 'preview-signing']
    : ['release-public-key.txt', 'RELEASE_SIGNING_KEY', 'release-signing']
  const { publicKey, privateKey } = await generateKeyPair()
  execFileSync('pbcopy', { input: privateKey })
  const prompt = createInterface({ input: process.stdin, output: process.stdout })
  await prompt.question(`A new private key is on the clipboard. Paste it as ${secret} in the ${environment} environment, then press Enter. `)
  prompt.close()
  writeFileSync(join(import.meta.dirname, '..', '..', 'apps', 'client', file), publicKey + '\n')
  if (execFileSync('pbpaste', { encoding: 'utf8' }) === privateKey) execFileSync('pbcopy', { input: '' })
  console.log(`Wrote apps/client/${file}; commit it. The clipboard is cleared.`)
}
