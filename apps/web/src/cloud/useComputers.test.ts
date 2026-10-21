import { expect, test, vi } from 'vitest'

test('a background reload keeps what is on screen, Try again shows loading', async () => {
  vi.stubGlobal('__APP_COMMIT__', '')
  const { stateWhileReloading } = await import('./useComputers.ts')
  expect(stateWhileReloading('failed', true)).toBe('failed')
  expect(stateWhileReloading('fresh', true)).toBe('fresh')
  expect(stateWhileReloading('loading', true)).toBe('loading')
  expect(stateWhileReloading('failed', false)).toBe('loading')
  expect(stateWhileReloading('fresh', false)).toBe('loading')
})
