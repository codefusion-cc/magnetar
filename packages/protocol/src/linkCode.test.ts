import fc from 'fast-check'
import { describe, expect, test } from 'vitest'
import vector from './link-code-vector.json'
import { formatLinkCode, LINK_CODE_ALPHABET, linkCodeKey, readLinkCode } from './linkCode.ts'
import { bytesToBase64Url } from '@codefusion-cc/workers-crypto'

const symbols = fc.array(fc.constantFrom(...LINK_CODE_ALPHABET), { minLength: 20, maxLength: 20 }).map(chars => chars.join(''))

describe('reading a typed code', () => {
  test('takes the code however a person writes it: case, groups, spaces, any dash', () => {
    const code = 'K7QM29TXFAW4HNPZR6BD'
    for (const text of ['K7QM29TXFAW4HNPZR6BD', 'k7qm2-9txfa-w4hnp-zr6bd', ' K7QM2 9TXFA W4HNP ZR6BD ', 'K7QM2‐9TXFA–W4HNP−ZR6BD', 'K7QM2-9TXFA-W4HNP-ZR6BD\n']) {
      expect(readLinkCode(text), text).toEqual({ code })
    }
  })

  test('reads the look-alikes as Crockford does: O is 0, I and L are 1', () => {
    expect(readLinkCode('OOOOO-IIIII-LLLLL-0Il1o')).toEqual({ code: '00000' + '11111' + '11111' + '01110' })
  })

  test('says what is wrong, and a wrong character wins over a wrong length', () => {
    expect(readLinkCode('')).toEqual({ problem: 'incomplete' })
    expect(readLinkCode('K7QM2-9TXFA')).toEqual({ problem: 'incomplete' })
    expect(readLinkCode('K7QM29TXFAW4HNPZR6B')).toEqual({ problem: 'incomplete' })
    expect(readLinkCode('K7QM29TXFAW4HNPZR6BDX')).toEqual({ problem: 'too-long' })
    expect(readLinkCode('K7QM29TXFAW4HNPZR6BU')).toEqual({ problem: 'characters' })
    expect(readLinkCode('K7QM29TXFAW4HNPZR6B!')).toEqual({ problem: 'characters' })
    expect(readLinkCode('K7QM29TXFAW4HNPZR6BÉ')).toEqual({ problem: 'characters' })
    expect(readLinkCode('U')).toEqual({ problem: 'characters' })
    expect(readLinkCode('\u{1F600}'.repeat(20))).toEqual({ problem: 'characters' })
    expect(readLinkCode('A'.repeat(1_000_000))).toEqual({ problem: 'too-long' })
  })

  test('a code written in groups reads back as itself', () => {
    fc.assert(fc.property(symbols, code => {
      expect(formatLinkCode(code)).toMatch(/^\w{5}-\w{5}-\w{5}-\w{5}$/)
      expect(readLinkCode(formatLinkCode(code))).toEqual({ code })
    }))
  })
})

describe('the key a code stands for', () => {
  test('is the one the device derives (the Rust side checks the same vector)', async () => {
    for (const { code, keyId, key } of vector) {
      const derived = await linkCodeKey(code)
      expect(derived.keyId).toBe(keyId)
      expect(bytesToBase64Url(derived.key)).toBe(key)
    }
  })

  test('is 32 bytes with a 12-character id, and every symbol and position counts', async () => {
    const base = 'K7QM29TXFAW4HNPZR6BD'
    const seen = new Set([(await linkCodeKey(base)).keyId])
    expect((await linkCodeKey(base)).key).toHaveLength(32)
    expect([...seen][0]).toHaveLength(12)
    for (let at = 0; at < base.length; at++) {
      const other = base.slice(0, at) + (base[at] === 'Z' ? '0' : 'Z') + base.slice(at + 1)
      seen.add((await linkCodeKey(other)).keyId)
    }
    expect(seen.size).toBe(21)
  })

  test('does not depend on how the code was spelled', async () => {
    const typed = readLinkCode('k7qm2 9txfa w4hnp zr6bd')
    const clean = readLinkCode('K7QM29TXFAW4HNPZR6BD')
    expect(typed).toEqual(clean)
    const options = fc.constantFrom('0', 'O', 'o')
    await fc.assert(fc.asyncProperty(fc.array(options, { minLength: 20, maxLength: 20 }), async chars => {
      const read = readLinkCode(chars.join('')) as { code: string }
      expect(read.code).toBe('0'.repeat(20))
      expect((await linkCodeKey(read.code)).keyId).toBe(vector[0]!.keyId)
    }), { numRuns: 10 })
  })
})
