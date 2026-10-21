/**
 * Generates the Ed25519 key pair that signs release manifests. Run once:
 *
 *   node packages/release/release-key.ts [--preview]
 *
 * Commit the public key file it writes; store the private key as the GitHub Actions secret
 * RELEASE_SIGNING_KEY (it is printed once and written nowhere). Installed apps only accept updates
 * whose SHA256SUMS.txt is signed by this key.
 *
 * `--preview` makes Magnetar Preview's own pair: preview-public-key.txt, and PREVIEW_SIGNING_KEY in the main-only
 * environment preview-signing. Its private key goes to the clipboard (macOS) rather than the terminal, for pasting
 * into the secret's card, and is cleared from it once you press Enter.
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
  const file = preview ? 'preview-public-key.txt' : 'release-public-key.txt'
  const { publicKey, privateKey } = await generateKeyPair()
  if (preview) {
    // Before the public key is written, so a failed copy leaves nothing to commit.
    execFileSync('pbcopy', { input: privateKey })
    writeFileSync(join(import.meta.dirname, '..', '..', 'apps', 'client', file), publicKey + '\n')
    console.log(`Wrote apps/client/${file}; commit it.`)
    console.log('The private key is on the clipboard: paste it as PREVIEW_SIGNING_KEY in the preview-signing environment.')
    // Without a terminal to wait on, clearing it is left to whoever pastes it.
    if (process.stdin.isTTY) {
      const prompt = createInterface({ input: process.stdin, output: process.stdout })
      await prompt.question('Press Enter once it is saved to clear the clipboard. ')
      prompt.close()
      if (execFileSync('pbpaste', { encoding: 'utf8' }) === privateKey) execFileSync('pbcopy', { input: '' })
    }
  } else {
    writeFileSync(join(import.meta.dirname, '..', '..', 'apps', 'client', file), publicKey + '\n')
    console.log(`Wrote apps/client/${file}; commit it.`)
    console.log('\nStore this as the RELEASE_SIGNING_KEY repository secret, then forget it:\n')
    console.log(privateKey)
  }
}
