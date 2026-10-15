import fc from 'fast-check'
import { describe, expect, test } from 'vitest'
import { findTyped, moveActive, PAGE_STEP, typedCharacter } from './selectKeys.ts'

const KEYS = ['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End']

describe('moving through an open list', () => {
  test('every move stays inside the list, whatever the key, the place and the length', () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 500 }), fc.nat(), fc.constantFrom(...KEYS), (length, at, key) => {
      const moved = moveActive(key, at % length, length)
      expect(moved).not.toBeNull()
      expect(moved!).toBeGreaterThanOrEqual(0)
      expect(moved!).toBeLessThan(length)
    }))
  })

  test('the ends stop it instead of wrapping round, as a system menu does', () => {
    expect(moveActive('ArrowDown', 4, 5)).toBe(4)
    expect(moveActive('ArrowUp', 0, 5)).toBe(0)
    expect(moveActive('PageDown', 3, 5)).toBe(4)
    expect(moveActive('PageUp', 3, 50)).toBe(0)
  })

  test('arrows move one, Page keys ten, Home and End to the ends', () => {
    expect(moveActive('ArrowDown', 2, 50)).toBe(3)
    expect(moveActive('ArrowUp', 2, 50)).toBe(1)
    expect(moveActive('PageDown', 2, 50)).toBe(2 + PAGE_STEP)
    expect(moveActive('PageUp', 30, 50)).toBe(30 - PAGE_STEP)
    expect(moveActive('Home', 30, 50)).toBe(0)
    expect(moveActive('End', 3, 50)).toBe(49)
  })

  test('other keys, and an empty list, move nothing', () => {
    for (const key of ['Enter', ' ', 'Escape', 'Tab', 'a', 'ArrowLeft']) expect(moveActive(key, 1, 5), key).toBeNull()
    expect(moveActive('ArrowDown', 0, 0)).toBeNull()
  })
})

describe('typing to find an option', () => {
  const languages = ['English', 'Polski', 'Deutsch', 'Español', 'Français', 'Italiano', 'Português', 'Русский']

  test('a letter finds the next option it starts, without case or accents', () => {
    expect(findTyped(languages, 'p', 0)).toBe(1)
    expect(findTyped(languages, 'P', 1)).toBe(6)
    expect(findTyped(languages, 'e', 0)).toBe(3)
    expect(findTyped(languages, 'f', 0)).toBe(4)
    expect(findTyped(languages, 'р', 0)).toBe(7)
  })

  test('the same letter again steps through the options it starts, round to the first', () => {
    const seen: number[] = []
    let at = 0
    for (let i = 0; i < 3; i++) { at = findTyped(languages, 'p', at)!; seen.push(at) }
    expect(seen).toEqual([1, 6, 1])
    // "pp" typed quickly is that letter pressed twice, not a word.
    expect(findTyped(languages, 'pp', 1)).toBe(6)
  })

  test('a word finds the option it starts, staying on the current one while it still matches', () => {
    expect(findTyped(languages, 'po', 1)).toBe(1)
    expect(findTyped(languages, 'por', 1)).toBe(6)
    expect(findTyped(languages, 'deu', 7)).toBe(2)
  })

  test('nothing matching leaves the list where it was', () => {
    expect(findTyped(languages, 'x', 2)).toBeNull()
    expect(findTyped(languages, 'po z', 1)).toBeNull()
    expect(findTyped([], 'a', 0)).toBeNull()
    expect(findTyped(languages, '', 0)).toBeNull()
  })

  test('whatever it finds starts with what was typed, and it finds one whenever one does', () => {
    fc.assert(fc.property(fc.array(fc.string({ minLength: 1, maxLength: 6 }), { minLength: 1, maxLength: 12 }), fc.string({ minLength: 1, maxLength: 3 }), fc.nat(),
      (labels, typed, at) => {
        const fold = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase()
        const found = findTyped(labels, typed, at % labels.length)
        const any = labels.some(l => fold(l).startsWith(fold(typed)))
        if (any) expect(found).not.toBeNull()
        if (found !== null) {
          const label = fold(labels[found]!)
          const wanted = fold(typed)
          expect(label.startsWith(wanted) || label.startsWith(wanted[0]!)).toBe(true)
        }
      }))
  })
})

describe('which keys are typing', () => {
  const key = (k: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean }> = {}) => ({ key: k, ctrlKey: false, metaKey: false, altKey: false, ...mods })

  test('a printable character is, in any script', () => {
    expect(typedCharacter(key('a'))).toBe('a')
    expect(typedCharacter(key('Ż'))).toBe('Ż')
    expect(typedCharacter(key('ж'))).toBe('ж')
  })

  test('Space is only in the middle of a word', () => {
    expect(typedCharacter(key(' '))).toBeNull()
    expect(typedCharacter(key(' '), true)).toBe(' ')
  })

  test('named keys and shortcuts are not', () => {
    expect(typedCharacter(key('Enter'))).toBeNull()
    expect(typedCharacter(key('ArrowDown'))).toBeNull()
    expect(typedCharacter(key('c', { metaKey: true }))).toBeNull()
    expect(typedCharacter(key('c', { ctrlKey: true }))).toBeNull()
    expect(typedCharacter(key('c', { altKey: true }))).toBeNull()
  })
})
