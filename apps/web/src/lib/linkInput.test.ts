import { describe, expect, test } from 'vitest'
import { linkFragment } from '@magnetar/protocol/e2e'
import { readLinkInput } from './linkInput.ts'

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
    expect(readLinkInput('not a code at all, much longer than twenty symbols!', ORIGIN)).toEqual({ problem: 'characters' })
    expect(readLinkInput('https://' + 'a'.repeat(100_000), ORIGIN)).toEqual({ problem: 'not-a-link' })
    expect(readLinkInput('https://', ORIGIN)).toEqual({ problem: 'not-a-link' })
    expect(readLinkInput('\u0000￾', ORIGIN)).toEqual({ problem: 'characters' })
  })
})
