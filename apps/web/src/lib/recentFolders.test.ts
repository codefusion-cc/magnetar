import { describe, expect, test } from 'vitest'
import { chipLabels, exceedsFreeSpace, folderChoices, MAX_RECENT_FOLDERS, readRecentFolders, rememberFolder, rowActions, shortFolder, startedNotice, usableOrDefault, withRecent } from './recentFolders.ts'

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

describe('recent folder chips', () => {
  test('stay short when each folder has a name of its own', () => {
    expect(chipLabels(['/Volumes/Media/Films', '/Volumes/Media/TV'])).toEqual(['Films', 'TV'])
  })

  test('show enough of the parent to tell equal last segments apart', () => {
    expect(chipLabels(['/Volumes/External/Films', '/Volumes/Media/Films', '/Volumes/Media/TV'])).toEqual(['External › Films', 'Media › Films', 'TV'])
  })

  test('go as deep as it takes, for Windows paths too', () => {
    expect(chipLabels(['D:\\A\\X\\Films', 'E:\\B\\X\\Films'])).toEqual(['A › X › Films', 'B › X › Films'])
  })

  test('a root with no segment is shown as it is', () => {
    expect(chipLabels(['/'])).toEqual(['/'])
  })
})

describe('the free space warning', () => {
  test('shows only when the size is known and larger than the free space; equal fits', () => {
    expect(exceedsFreeSpace(101, 100)).toBe(true)
    expect(exceedsFreeSpace(100, 100)).toBe(false)
    expect(exceedsFreeSpace(99, 100)).toBe(false)
    expect(exceedsFreeSpace(null, 100)).toBe(false)
    expect(exceedsFreeSpace(500, null)).toBe(false)
    expect(exceedsFreeSpace(0, 0)).toBe(false)
  })
})

describe('a result row', () => {
  test('has a Download to… button of its own unless the setting asks every time, then one Download…', () => {
    expect(rowActions(false)).toEqual({ downloadToButton: true, downloadLabelKey: 'common.download' })
    expect(rowActions(true)).toEqual({ downloadToButton: false, downloadLabelKey: 'common.downloadAsk' })
  })
})

describe('the notice that a download was added', () => {
  test('names the folder it was saved to, short', () => {
    expect(startedNotice({ plain: 'a', inFolder: 'b' }, '/Volumes/Media/Films')).toEqual({ key: 'b', folder: 'Films' })
    expect(startedNotice({ plain: 'a', inFolder: 'b' }, 'C:\\Users\\me\\TV')).toEqual({ key: 'b', folder: 'TV' })
  })

  test('says nothing of a folder when the default one was used', () => {
    expect(startedNotice({ plain: 'a', inFolder: 'b' })).toEqual({ key: 'a' })
    expect(startedNotice({ plain: 'a', inFolder: 'b' }, '  ')).toEqual({ key: 'a' })
    expect(shortFolder('/')).toBe('/')
  })
})
