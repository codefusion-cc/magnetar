import { parseLinkFragment } from '@magnetar/protocol/e2e'
import { readLinkCode, type LinkCodeProblem } from '@magnetar/protocol/link-code'

/** What a person typed, pasted or scanned to link a browser. */
export type LinkInput =
  | { kind: 'link'; deviceId: string; keyId: string; key: Uint8Array<ArrayBuffer> }
  | { kind: 'code'; code: string }

export type LinkInputProblem = LinkCodeProblem | 'other-site' | 'not-a-link'

/** A link is long, but not this long: anything bigger is not one, and is not parsed. */
const MAX_LINK = 2048

/**
 * The link or code in `text`, or what is wrong with it. A link counts only for `origin` and its `/link` page, so a
 * scanned or pasted address for anywhere else links nothing; no address is ever opened. Never throws.
 */
export function readLinkInput(text: string, origin: string): LinkInput | { problem: LinkInputProblem } {
  const trimmed = text.trim()
  if (/^[a-z][a-z\d+.-]*:/i.test(trimmed)) {
    if (trimmed.length > MAX_LINK) return { problem: 'not-a-link' }
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
  return 'code' in read ? { kind: 'code', code: read.code } : { problem: read.problem }
}
