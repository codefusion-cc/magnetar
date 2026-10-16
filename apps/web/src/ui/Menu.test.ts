import fc from 'fast-check'
import { expect, test } from 'vitest'
import { nextFocusIndex } from './Menu.tsx'

test('keyboard focus wraps, Home and End reach boundaries and unrelated keys do nothing', () => {
  expect(nextFocusIndex('ArrowLeft', 0, 3)).toBe(2)
  expect(nextFocusIndex('ArrowRight', 2, 3)).toBe(0)
  expect(nextFocusIndex('ArrowDown', 0, 1)).toBe(0)
  expect(nextFocusIndex('Home', 2, 3)).toBe(0)
  expect(nextFocusIndex('End', 0, 3)).toBe(2)
  expect(nextFocusIndex('Tab', 0, 3)).toBeNull()
  expect(nextFocusIndex('ArrowDown', 0, 0)).toBeNull()
  fc.assert(fc.property(fc.integer({ min: 1, max: 1000 }), fc.nat(), (length, n) => {
    const at = n % length
    const next = nextFocusIndex('ArrowDown', at, length)!
    expect(next).toBeGreaterThanOrEqual(0)
    expect(next).toBeLessThan(length)
    expect(nextFocusIndex('ArrowUp', next, length)).toBe(at)
  }))
})
