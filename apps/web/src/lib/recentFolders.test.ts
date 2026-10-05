import { describe, expect, test } from 'vitest'
import { folderChoices, MAX_RECENT_FOLDERS, readRecentFolders, rememberFolder, usableOrDefault, withRecent } from './recentFolders.ts'

const memory = () => {
  const data = new Map<string, string>()
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) }
}
const blocked = {
  getItem: () => { throw new Error('SecurityError') },
  setItem: () => { throw new Error('QuotaExceededError') },
}

describe('recent folders', () => {
  test('are most recent first and without repeats', () => {
    expect(withRecent(['/a', '/b', '/c'], '/b')).toEqual(['/b', '/a', '/c'])
    expect(withRecent([], '  ')).toEqual([])
  })

  test('keep at most the limit, dropping the oldest', () => {
    let list: string[] = []
    for (let i = 0; i < MAX_RECENT_FOLDERS + 3; i++) list = withRecent(list, `/f${i}`)
    expect(list).toHaveLength(MAX_RECENT_FOLDERS)
    expect(list[0]).toBe(`/f${MAX_RECENT_FOLDERS + 2}`)
  })

  test('are remembered per device in browser storage and read back', () => {
    const storage = memory()
    rememberFolder('nas', '/a', storage)
    expect(rememberFolder('nas', '/b', storage)).toEqual(['/b', '/a'])
    expect(readRecentFolders('nas', storage)).toEqual(['/b', '/a'])
    expect(readRecentFolders('laptop', storage)).toEqual([])
  })

  test('work without browser storage', () => {
    expect(readRecentFolders('nas', blocked)).toEqual([])
    expect(rememberFolder('nas', '/a', blocked)).toEqual(['/a'])
    expect(readRecentFolders('nas', undefined)).toEqual([])
  })

  test('work where merely touching localStorage throws', () => {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get: () => { throw new Error('SecurityError') } })
    try {
      expect(readRecentFolders('nas')).toEqual([])
      expect(rememberFolder('nas', '/a')).toEqual(['/a'])
    } finally {
      delete (globalThis as { localStorage?: unknown }).localStorage
    }
  })

  test('ignore stored values that are not a list of paths', () => {
    for (const raw of ['{', '"x"', '{"a":1}', 'null']) {
      const storage = { getItem: () => raw, setItem: () => {} }
      expect(readRecentFolders('nas', storage)).toEqual([])
    }
    expect(readRecentFolders('nas', { getItem: () => '["/a",3,null,"/a"," ","/b"]', setItem: () => {} })).toEqual(['/a', '/b'])
  })
})

describe('the folders offered for saving', () => {
  const dl = (savePath: string, addedAt: string) => ({ savePath, addedAt })

  test('the latest download not in the default folder comes first, then what the browser remembers', () => {
    const downloads = [dl('/media/old', '2026-01-01T00:00:00Z'), dl('/downloads', '2026-03-01T00:00:00Z'), dl('/media/new', '2026-02-01T00:00:00Z')]
    expect(folderChoices(downloads, ['/media/new', '/tv'], '/downloads')).toEqual(['/media/new', '/media/old', '/tv'])
  })

  test('the default folder, with or without a trailing slash, is never a choice', () => {
    expect(folderChoices([dl('/downloads/', '2026-01-01T00:00:00Z')], ['/downloads'], '/downloads')).toEqual([])
  })

  test('no downloads and no storage: nothing remembered', () => {
    expect(folderChoices([], [], '/downloads')).toEqual([])
  })
})

describe('where the browser opens', () => {
  test('the remembered folder is used on the next open', async () => {
    expect(await usableOrDefault('/media/films', '/downloads', async () => true)).toBe('/media/films')
  })

  test('a remembered folder that is gone, or refuses, falls back to the default folder', async () => {
    expect(await usableOrDefault('/Volumes/Unplugged', '/downloads', async () => false)).toBe('/downloads')
    expect(await usableOrDefault('/Volumes/Unplugged', '/downloads', async () => { throw new Error('offline') })).toBe('/downloads')
  })

  test('nothing remembered opens the default folder without asking the device', async () => {
    const asked: string[] = []
    expect(await usableOrDefault('', '/downloads', async f => { asked.push(f); return true })).toBe('/downloads')
    expect(asked).toEqual([])
  })
})
