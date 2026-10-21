/**
 * Generates an Ed25519 key pair that signs release manifests, in a terminal on macOS with gh signed in:
 *
 *   node packages/release/release-key.ts [--preview]
 *
 * The private key goes to the clipboard, never the terminal or a file: paste it as RELEASE_SIGNING_KEY in the
 * main-only environment release-signing, or with `--preview` as PREVIEW_SIGNING_KEY in preview-signing, then press
 * Enter. Once GitHub shows that secret saved since the start, the public key is written (release-public-key.txt or
 * preview-public-key.txt; commit it). However it ends, the clipboard is cleared if it still holds the key; any other
 * key than Enter, or the key pasted here, stops it with nothing written. Installed apps only accept updates whose
 * SHA256SUMS.txt is signed by the key their build compiled in.
 */
import { execFileSync } from 'node:child_process'
import { realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'

export async function generateKeyPair(): Promise<{ publicKey: string; privateKey: string }> {
  const pair = (await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify'])) as CryptoKeyPair
  return {
    publicKey: Buffer.from(await crypto.subtle.exportKey('raw', pair.publicKey)).toString('base64url'),
    privateKey: Buffer.from(await crypto.subtle.exportKey('pkcs8', pair.privateKey)).toString('base64url'),
  }
}

/** What the next keypress sends, unechoed. A paste arrives in pieces: they are all read, so none reach the shell after. */
function keypress(): Promise<string> {
  return new Promise((resolve) => {
    let input = ''
    let timer: NodeJS.Timeout | undefined
    const read = (data: Buffer) => {
      input += data.toString('utf8')
      clearTimeout(timer)
      timer = setTimeout(() => {
        process.stdin.off('data', read).setRawMode(false).pause()
        resolve(input)
      }, 200)
    }
    process.stdin.setRawMode(true).resume().on('data', read)
  })
}

/** Clears the clipboard if it still holds `key`, and says what became of it. */
function clearClipboard(key: string): string {
  try {
    if (execFileSync('pbpaste', { encoding: 'utf8' }) !== key) return 'The clipboard no longer held the key; it is left as is.'
    execFileSync('pbcopy', { input: '' })
    return 'The clipboard is cleared.'
  } catch {
    return 'The clipboard could not be read: copy something else to clear it.'
  }
}

if (realpathSync(process.argv[1] ?? '.') === import.meta.filename) {
  const preview = parseArgs({ options: { preview: { type: 'boolean', default: false } } }).values.preview
  if (!process.stdin.isTTY) throw new Error('Run it in a terminal: it waits while you paste the key')
  const [file, secret, environment] = preview
    ? ['preview-public-key.txt', 'PREVIEW_SIGNING_KEY', 'preview-signing']
    : ['release-public-key.txt', 'RELEASE_SIGNING_KEY', 'release-signing']
  // GitHub's clock and this Mac's may differ a little.
  const started = Date.now() - 60_000
  const { publicKey, privateKey } = await generateKeyPair()
  execFileSync('pbcopy', { input: privateKey })
  try {
    process.stdout.write(`A new private key is on the clipboard. Paste it as ${secret} in the ${environment} environment, then press Enter here. `)
    const key = await keypress()
    process.stdout.write('\n')
    if (key.length > 1 && key !== '\r\n') throw new Error('That went into this terminal, not the secret: nothing is written. Run it again.')
    if (key !== '\r' && key !== '\n' && key !== '\r\n') throw new Error('Stopped: nothing is written.')
    let updated = ''
    try {
      updated = execFileSync('gh', ['api', `repos/{owner}/{repo}/environments/${environment}/secrets/${secret}`, '--jq', '.updated_at'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim()
    } catch {
      // Not saved yet (404), or gh can't reach GitHub: either way nothing is written.
    }
    if (!(Date.parse(updated) >= started)) throw new Error(`GitHub shows no ${secret} in ${environment} saved since this started: nothing is written. Run it again.`)
    writeFileSync(join(import.meta.dirname, '..', '..', 'apps', 'client', file), publicKey + '\n')
    console.log(`Wrote apps/client/${file}; commit it.`)
  } catch (error) {
    console.error((error as Error).message)
    process.exitCode = 1
  } finally {
    console.log(clearClipboard(privateKey))
  }
}
