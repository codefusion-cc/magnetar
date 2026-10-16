import { expect, test } from 'vitest'
import { consolePage } from './consolePages.ts'

test('names the screen a path shows, never the device in it', () => {
  expect(consolePage('/', true)).toBe('devices')
  expect(consolePage('', true)).toBe('devices')
  expect(consolePage('/', false)).toBe('home')
  expect(consolePage('/login', false)).toBe('login')
  for (const page of ['about', 'login', 'pair', 'link', 'add', 'features'] as const) expect(consolePage(`/${page}`, false)).toBe(page)
  expect(consolePage('/pair/abc', true)).toBe('pair')
  expect(consolePage('/features/pl', true)).toBe('features')
  expect(consolePage('/MacBook-Pro', true)).toBe('device-downloads')
  expect(consolePage('/MacBook-Pro/', true)).toBe('device-downloads')
  expect(consolePage('/MacBook-Pro/search/dragon', true)).toBe('device-search')
  expect(consolePage('/MacBook-Pro/series/releases', true)).toBe('device-series')
  expect(consolePage('/MacBook-Pro/settings/agents', true)).toBe('device-settings')
  expect(consolePage('/MacBook-Pro/files', true)).toBe('device-files')
  expect(consolePage('/MacBook-Pro/nope', true)).toBe('device-downloads')
  // Addresses by id, before they move to the name.
  expect(consolePage('/d/d_123/search', true)).toBe('device-search')
  expect(consolePage('/d/d_123', true)).toBe('device-downloads')
  // A device named like a tab is still a device.
  expect(consolePage('/search-box/settings', true)).toBe('device-settings')
})
