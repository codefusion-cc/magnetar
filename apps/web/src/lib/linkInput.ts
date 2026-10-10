import { parseLinkFragment } from '@magnetar/protocol/e2e'
import { formatLinkCode, linkCodeSymbols, readLinkCode } from '@magnetar/protocol/link-code'

/** What a person typed, pasted or scanned to link a browser. */
export type LinkInput =
  | { kind: 'link'; deviceId: string; keyId: string; key: Uint8Array<ArrayBuffer> }
  | { kind: 'code'; code: string }

export type LinkInputProblem =
  | { problem: 'incomplete' | 'too-long' | 'other-site' | 'not-a-link' }
  /** `character` is the first one no code has. */
  | { problem: 'characters'; character: string }

/** A link is long, but not this long: anything bigger is neither a link nor a code, and is not parsed. */
export const MAX_LINK_INPUT = 2048

const ADDRESS = /^[a-z][a-z\d+.-]*:/i

/**
 * The link or code in `text`, or what is wrong with it. A link counts only for `origin` and its `/link` page, so a
 * scanned or pasted address for anywhere else links nothing; no address is ever opened. Never throws.
 */
export function readLinkInput(text: string, origin: string): LinkInput | LinkInputProblem {
  const trimmed = text.trim()
  const address = ADDRESS.test(trimmed)
  if (trimmed.length > MAX_LINK_INPUT) return { problem: address ? 'not-a-link' : 'too-long' }
  if (address) {
    let url: URL
    try {
      url = new URL(trimmed)
    } catch {
      return { problem: 'not-a-link' }
    }
    if (url.origin !== origin) return { problem: 'other-site' }
    const link = url.pathname === '/link' ? parseLinkFragment(url.hash) : null
    return link ? { kind: 'link', ...link } : { problem: 'not-a-link' }
  }
  const read = readLinkCode(trimmed)
  return 'code' in read ? { kind: 'code', code: read.code } : read
}

/** A code as far as it is typed: letters, digits and what separates its groups, and not more than a code and a slip. */
const CODE_SO_FAR = /^[\sA-Za-z\d\-\u2010-\u2015\u2212]{0,64}$/

/**
 * What the code field shows for what was typed into it, and where its caret goes: a code is written the way the
 * device shows it, `XXXXX-XXXXX-XXXXX-XXXXX`, in upper case and with look-alikes read as the symbols they stand for,
 * so the two can be compared at a glance and nobody types a hyphen. The caret stays behind the symbol it was behind.
 * Anything that is not a code so far (a pasted link) is left as it is. `before` is what the field showed until now:
 * a hyphen deleted by itself would only come back, so the symbol in front of it goes with it, or the one behind it
 * when the deletion was `forward`.
 */
export function shapeCodeField(text: string, caret: number, before = '', forward = false): { text: string; caret: number } {
  if (!CODE_SO_FAR.test(text)) return { text, caret }
  let symbols = linkCodeSymbols(text)
  let ahead = linkCodeSymbols(text.slice(0, caret)).length
  if (before[caret] === '-' && text === before.slice(0, caret) + before.slice(caret + 1)) {
    if (!forward && ahead > 0) ahead--
    symbols = symbols.slice(0, ahead) + symbols.slice(ahead + 1)
  }
  return { text: formatLinkCode(symbols), caret: ahead + Math.floor(Math.max(0, ahead - 1) / 5) }
}
