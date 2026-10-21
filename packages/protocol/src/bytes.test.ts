import fc from 'fast-check'
import { expect, test } from 'vitest'
import { formatBytes } from './bytes.ts'

test('a size that rounds up to the next unit is said in that unit', () => {
  expect(formatBytes(999_960, 1, { decimal: true, locale: 'en' })).toBe('1\u00a0MB')
  expect(formatBytes(999_949, 1, { decimal: true, locale: 'en' })).toBe('999.9\u00a0KB')
  expect(formatBytes(1024 * 1024 - 1)).toBe('1\u00a0MiB')
  expect(formatBytes(999.6e9, 0, { decimal: true })).toBe('1\u00a0TB')
  // The last unit has nowhere to go.
  expect(formatBytes(2000e15, 1, { decimal: true })).toBe('2000\u00a0PB')
})

test('the number shown never reaches the next unit, also just under a unit', () => {
  const near = fc.tuple(fc.integer({ min: 1, max: 4 }), fc.double({ min: 0.999, max: 1, maxExcluded: true, noNaN: true }))
  fc.assert(fc.property(near, fc.integer({ min: 0, max: 3 }), fc.boolean(), ([power, under], decimals, decimal) => {
    const bytes = (decimal ? 1000 : 1024) ** power * under
    const [value, unit] = formatBytes(bytes, decimals, { decimal }).split('\u00a0')
    if (unit !== 'PB' && unit !== 'PiB') expect(Number(value)).toBeLessThan(decimal ? 1000 : 1024)
  }))
})
