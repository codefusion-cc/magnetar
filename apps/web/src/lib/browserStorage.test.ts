import { describe, expect, test } from 'vitest'
import { forgetDevicePreferences } from './browserStorage.ts'
import { readDownloadSort, writeDownloadSort } from './downloadSort.ts'
import { readRecentFolders, rememberFolder } from './recentFolders.ts'

/** A browser's storage, in memory, with the insertion order of keys that `key(i)` walks. */
function memory(): Storage {
  const map = new Map<string, string>()
  return {
    get length() { return map.size },
    key: i => [...map.keys()][i] ?? null,
    getItem: k => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: k => void map.delete(k),
    clear: () => map.clear(),
  }
}

function filled() {
  const storage = memory()
  for (const device of ['Mac', 'Home PC']) {
    rememberFolder(device, `/Volumes/${device}/Films`, storage)
    writeDownloadSort(device, 'name', storage)
  }
  storage.setItem('magnetar.theme', 'dark')
  return storage
}

describe('forgetting what this browser kept for devices', () => {
  test('one device: its recent folders and download order go, another device keeps its own', () => {
    const storage = filled()
    forgetDevicePreferences('Mac', storage)
    expect(readRecentFolders('Mac', storage)).toEqual([])
    expect(readDownloadSort('Mac', storage)).toBe('newest')
    expect(readRecentFolders('Home PC', storage)).toEqual(['/Volumes/Home PC/Films'])
    expect(readDownloadSort('Home PC', storage)).toBe('name')
  })

  test('a device whose name starts with another one is not touched', () => {
    const storage = memory()
    rememberFolder('Mac mini', '/a', storage)
    forgetDevicePreferences('Mac', storage)
    expect(readRecentFolders('Mac mini', storage)).toEqual(['/a'])
  })

  test('every device at once (sign-out), and nothing else in storage', () => {
    const storage = filled()
    forgetDevicePreferences(undefined, storage)
    expect(readRecentFolders('Mac', storage)).toEqual([])
    expect(readRecentFolders('Home PC', storage)).toEqual([])
    expect(readDownloadSort('Home PC', storage)).toBe('newest')
    expect(storage.length).toBe(1)
    expect(storage.getItem('magnetar.theme')).toBe('dark')
  })

  test('blocked or missing storage is no error', () => {
    const refusing = { length: 1, key: () => { throw new Error('blocked') }, removeItem: () => { throw new Error('blocked') } }
    expect(() => forgetDevicePreferences(undefined, refusing)).not.toThrow()
    expect(() => forgetDevicePreferences('Mac', refusing)).not.toThrow()
    expect(() => forgetDevicePreferences('Mac', undefined)).not.toThrow()
  })
})
