/**
 * The code a person types to link a browser: what the device shows beside the QR code.
 *
 * It is 20 symbols of a 32-symbol alphabet, 100 random bits, written `XXXXX-XXXXX-XXXXX-XXXXX`. The browser key
 * and its id are derived from it with HKDF, on the device when it makes the code and in the browser when the code is
 * typed, so nothing but the code has to cross. The relay sees the key id and the handshake this key salts once the
 * code is used, and a code much shorter than 128 bits would let it guess the code offline from them; 100 bits put that
 * out of reach. An online guess is a hello naming a key id the device does not hold, which changes nothing there, so
 * there is no attempt limit. The QR code carries a separate, fully random key (e2e.ts).
 * The device side is apps/client/src/protocol/link_code.rs; link-code-vector.json is checked by both.
 */
import { bytesToBase64Url } from '@codefusion-cc/workers-crypto'

/** Crockford's base 32: no I, L, O or U. */
export const LINK_CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
export const LINK_CODE_LENGTH = 20
const GROUP = 5
const SALT = 'magnetar-link-code-v1'
const KEY_BYTES = 32
const KEY_ID_BYTES = 9

export type LinkCodeProblem = 'incomplete' | 'too-long' | 'characters'

/** What separates the groups of a written code: any white space and any dash. */
const SEPARATORS = /[\s\-\u2010-\u2015\u2212]/g

/**
 * A person's text as code symbols: upper case, without spaces and dashes, and O, I and L read as 0, 1 and 1, as
 * Crockford's alphabet has it. Symbols no code has are kept, for `readLinkCode` to name.
 */
export function linkCodeSymbols(text: string): string {
  return text.toUpperCase().replace(SEPARATORS, '').replace(/O/g, '0').replace(/[IL]/g, '1')
}

/**
 * The 20 symbols a person's text stands for, or what is wrong with it: `characters` names the first one no code has.
 * Case, spaces and dashes do not matter, and look-alikes are read as `linkCodeSymbols` reads them. Never throws.
 */
export function readLinkCode(text: string): { code: string } | { problem: 'incomplete' | 'too-long' } | { problem: 'characters'; character: string } {
  const symbols = linkCodeSymbols(text)
  const stray = [...symbols].find(symbol => !LINK_CODE_ALPHABET.includes(symbol))
  if (stray !== undefined) return { problem: 'characters', character: stray }
  if (symbols.length < LINK_CODE_LENGTH) return { problem: 'incomplete' }
  return symbols.length > LINK_CODE_LENGTH ? { problem: 'too-long' } : { code: symbols }
}

/** `XXXXX-XXXXX-XXXXX-XXXXX` for the symbols typed so far. */
export function formatLinkCode(symbols: string): string {
  return symbols.match(new RegExp(`.{1,${GROUP}}`, 'g'))?.join('-') ?? ''
}

/** The 100 bits of a code as 13 bytes, the last four bits zero. */
function codeBytes(code: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(Math.ceil((code.length * 5) / 8))
  let bits = 0
  let held = 0
  let at = 0
  for (const symbol of code) {
    held = (held << 5) | LINK_CODE_ALPHABET.indexOf(symbol)
    bits += 5
    while (bits >= 8) {
      bits -= 8
      bytes[at++] = (held >> bits) & 0xff
    }
    held &= (1 << bits) - 1
  }
  if (bits > 0) bytes[at] = (held << (8 - bits)) & 0xff
  return bytes
}

/** The browser key and key id a code stands for. `code` is 20 symbols as `readLinkCode` returns them. */
export async function linkCodeKey(code: string): Promise<{ keyId: string; key: Uint8Array<ArrayBuffer> }> {
  const material = await crypto.subtle.importKey('raw', codeBytes(code), 'HKDF', false, ['deriveBits'])
  const derive = async (info: string, bytes: number) => new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: new TextEncoder().encode(SALT), info: new TextEncoder().encode(info) }, material, bytes * 8))
  return { keyId: bytesToBase64Url(await derive('key id', KEY_ID_BYTES)), key: await derive('key', KEY_BYTES) }
}
