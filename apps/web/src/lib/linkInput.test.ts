import fc from 'fast-check'
import { describe, expect, test } from 'vitest'
import { linkFragment } from '@magnetar/protocol/e2e'
import { formatLinkCode, LINK_CODE_ALPHABET, linkCodeSymbols, readLinkCode } from '@magnetar/protocol/link-code'
import { readLinkInput, shapeCodeField } from './linkInput.ts'

const ORIGIN = 'https://magnetar.codefusion.cc'
const key = Uint8Array.from({ length: 32 }, (_, i) => i)
const link = (origin = ORIGIN, path = '/link', fragment = linkFragment('dev1', 'key1', key)) => `${origin}${path}#${fragment}`

describe('what may link a browser', () => {
  test('the link of this site is read, with the device, the key id and the key', () => {
    expect(readLinkInput(link(), ORIGIN)).toEqual({ kind: 'link', deviceId: 'dev1', keyId: 'key1', key })
    expect(readLinkInput(`  ${link()}\n`, ORIGIN)).toMatchObject({ kind: 'link', deviceId: 'dev1' })
  })

  test('a typed code is read as a code', () => {
    expect(readLinkInput('k7qm2-9txfa-w4hnp-zr6bd', ORIGIN)).toEqual({ kind: 'code', code: 'K7QM29TXFAW4HNPZR6BD' })
  })

  test('an address for another site is refused, however it is dressed', () => {
    for (const text of [
      link('https://evil.example'),
      link('http://magnetar.codefusion.cc'),
      link('https://magnetar.codefusion.cc.evil.example'),
      link('https://magnetar.codefusion.cc:8443'),
      link('https://magnetar.codefusion.cc@evil.example'),
      link('https://evil.example/https://magnetar.codefusion.cc'),
    ]) {
      expect(readLinkInput(text, ORIGIN), text).toEqual({ problem: 'other-site' })
    }
  })

  test('addresses of this site that are not a link, and schemes that are not addresses, are refused', () => {
    for (const text of [
      link(ORIGIN, '/linkx'), link(ORIGIN, '/link/'), link(ORIGIN, '/devices'), `${ORIGIN}/link`, `${ORIGIN}/link#`,
      link(ORIGIN, '/link', 'd=dev1&i=key1'), link(ORIGIN, '/link', 'd=dev1&i=key1&k=AAAA'),
      link(ORIGIN, '/link', `d=dev1&k=${'A'.repeat(43)}`), `${ORIGIN}/link?d=dev1&i=key1&k=${'A'.repeat(43)}`,
    ]) {
      expect(readLinkInput(text, ORIGIN), text).toEqual({ problem: 'not-a-link' })
    }
    for (const text of ['javascript:alert(1)', 'data:text/html,<script>1</script>', 'file:///etc/passwd', 'mailto:a@b.c', 'WIFI:S:x;T:WPA;P:y;;']) {
      expect('kind' in readLinkInput(text, ORIGIN), text).toBe(false)
    }
  })

  test('a secret in the query is not a link: only the fragment counts', () => {
    expect(readLinkInput(`${ORIGIN}/link?${linkFragment('dev1', 'key1', key)}`, ORIGIN)).toEqual({ problem: 'not-a-link' })
  })

  test('text that is not a code says why, and never throws', () => {
    expect(readLinkInput('', ORIGIN)).toEqual({ problem: 'incomplete' })
    expect(readLinkInput('hello world', ORIGIN)).toEqual({ problem: 'incomplete' })
    expect(readLinkInput('not a code at all, much longer than twenty symbols!', ORIGIN)).toEqual({ problem: 'characters', character: ',' })
    expect(readLinkInput('K7QM2-9TXFA-W4HNP-ZR6BU', ORIGIN)).toEqual({ problem: 'characters', character: 'U' })
    expect(readLinkInput('https://' + 'a'.repeat(100_000), ORIGIN)).toEqual({ problem: 'not-a-link' })
    expect(readLinkInput('https://', ORIGIN)).toEqual({ problem: 'not-a-link' })
    expect(readLinkInput('\u0000￾', ORIGIN)).toEqual({ problem: 'characters', character: '\u0000' })
  })

  test('text far longer than a link is refused unread, whatever it holds', () => {
    expect(readLinkInput('A'.repeat(2048), ORIGIN)).toEqual({ problem: 'too-long' })
    expect(readLinkInput('A'.repeat(2049), ORIGIN)).toEqual({ problem: 'too-long' })
    expect(readLinkInput('!'.repeat(5_000_000), ORIGIN)).toEqual({ problem: 'too-long' })
    const longest = link() + '&x=' + 'a'.repeat(2048 - link().length - 3)
    expect(longest).toHaveLength(2048)
    expect(readLinkInput(longest, ORIGIN)).toMatchObject({ kind: 'link', deviceId: 'dev1' })
    expect(readLinkInput(longest + 'a', ORIGIN)).toEqual({ problem: 'not-a-link' })
  })
})

describe('the code field as a person types', () => {
  const symbol = fc.constantFrom(...LINK_CODE_ALPHABET)
  /** What a person may have in the field while typing a code: symbols in either case, look-alikes, spaces, dashes. */
  const typed = fc.array(fc.oneof(symbol, symbol.map(c => c.toLowerCase()), fc.constantFrom('o', 'O', 'i', 'L', 'U', ' ', '-', '–')), { maxLength: 40 }).map(chars => chars.join(''))
  const withCaret = typed.chain(text => fc.tuple(fc.constant(text), fc.nat({ max: text.length })))

  test('groups the code as the device shows it, symbol by symbol, with no hyphen to type', () => {
    let field = { text: '', caret: 0 }
    const shown: string[] = []
    for (const key of 'k7qm29txfaw4hnpzr6bd') {
      field = shapeCodeField(field.text + key, field.caret + 1, field.text)
      expect(field.caret).toBe(field.text.length)
      shown.push(field.text)
    }
    expect(shown.slice(3, 7)).toEqual(['K7QM', 'K7QM2', 'K7QM2-9', 'K7QM2-9T'])
    expect(field.text).toBe('K7QM2-9TXFA-W4HNP-ZR6BD')
  })

  test('a pasted code is regrouped however it was written, and look-alikes become the symbols they stand for', () => {
    expect(shapeCodeField('k7qm29txfaw4hnpzr6bd', 20)).toEqual({ text: 'K7QM2-9TXFA-W4HNP-ZR6BD', caret: 23 })
    expect(shapeCodeField(' K7QM2 9TXFA W4HNP ZR6BD ', 25)).toEqual({ text: 'K7QM2-9TXFA-W4HNP-ZR6BD', caret: 23 })
    expect(shapeCodeField('K7QM–29TX', 9)).toEqual({ text: 'K7QM2-9TX', caret: 9 })
    expect(shapeCodeField('oOiIlL', 6)).toEqual({ text: '00111-1', caret: 7 })
  })

  test('a pasted link, or anything else that is no code, is left exactly as it is', () => {
    for (const text of [link(), 'https://', 'hello, world', 'K7QM2!', 'É', '\u{1F600}', 'A'.repeat(65)]) {
      expect(shapeCodeField(text, 3), text).toEqual({ text, caret: 3 })
    }
  })

  test('what is wrong with a code stays in view: a symbol no code has, and symbols past the twentieth', () => {
    expect(shapeCodeField('k7qmu', 5).text).toBe('K7QMU')
    expect(shapeCodeField('K7QM29TXFAW4HNPZR6BDXY', 22).text).toBe('K7QM2-9TXFA-W4HNP-ZR6BD-XY')
  })

  test('a symbol typed in the middle keeps the caret behind it, also across a group', () => {
    expect(shapeCodeField('K7XQM2-9T', 3, 'K7QM2-9T')).toEqual({ text: 'K7XQM-29T', caret: 3 })
    expect(shapeCodeField('K7QM2X-9T', 6, 'K7QM2-9T')).toEqual({ text: 'K7QM2-X9T', caret: 7 })
    expect(shapeCodeField('K7QM2-X9T', 7, 'K7QM2-9T')).toEqual({ text: 'K7QM2-X9T', caret: 7 })
  })

  test('deleting backwards over a hyphen deletes the symbol in front of it; forwards, the one behind', () => {
    expect(shapeCodeField('K7QM29T', 5, 'K7QM2-9T')).toEqual({ text: 'K7QM9-T', caret: 4 })
    expect(shapeCodeField('K7QM29T', 5, 'K7QM2-9T', true)).toEqual({ text: 'K7QM2-T', caret: 5 })
    // Any other deletion is just what it looks like.
    expect(shapeCodeField('K7QM2-T', 6, 'K7QM2-9T')).toEqual({ text: 'K7QM2-T', caret: 5 })
    expect(shapeCodeField('K7QM-9T', 4, 'K7QM2-9T')).toEqual({ text: 'K7QM9-T', caret: 4 })
    expect(shapeCodeField('', 0, 'K')).toEqual({ text: '', caret: 0 })
  })

  test('shaping never changes what the text means, and shaping twice changes nothing more', () => {
    fc.assert(fc.property(withCaret, ([text, caret]) => {
      const shaped = shapeCodeField(text, caret)
      expect(readLinkCode(shaped.text)).toEqual(readLinkCode(text))
      expect(shaped.text).toBe(formatLinkCode(linkCodeSymbols(text)))
      expect(shapeCodeField(shaped.text, shaped.caret, shaped.text)).toEqual(shaped)
    }))
  })

  test('the caret stays behind the same symbol, inside the text, and never right behind a hyphen', () => {
    fc.assert(fc.property(withCaret, ([text, caret]) => {
      const shaped = shapeCodeField(text, caret)
      expect(shaped.caret).toBeGreaterThanOrEqual(0)
      expect(shaped.caret).toBeLessThanOrEqual(shaped.text.length)
      expect(linkCodeSymbols(shaped.text.slice(0, shaped.caret))).toBe(linkCodeSymbols(text.slice(0, caret)))
      expect(shaped.text[shaped.caret - 1]).not.toBe('-')
    }))
  })
})
