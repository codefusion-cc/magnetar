import { expect, test } from 'vitest'
import { stateWhileReloading } from './useComputers.ts'

test('a background reload keeps what is on screen, Try again shows loading', () => {
  expect(stateWhileReloading('failed', true)).toBe('failed')
  expect(stateWhileReloading('fresh', true)).toBe('fresh')
  expect(stateWhileReloading('loading', true)).toBe('loading')
  expect(stateWhileReloading('failed', false)).toBe('loading')
  expect(stateWhileReloading('fresh', false)).toBe('loading')
})
