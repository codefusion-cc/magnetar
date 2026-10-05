/** How many folders the browser offers for a quick jump. */
export const MAX_RECENT_FOLDERS = 5

/** The folders in `list` with `folder` first and no repeats, at most `max` of them. A blank folder changes nothing. */
export function withRecent(list: readonly string[], folder: string, max = MAX_RECENT_FOLDERS): string[] {
  const path = folder.trim()
  if (!path) return [...list]
  return [path, ...list.filter(f => f !== path)].slice(0, max)
}

/** Only strings, no blanks or repeats, at most `max`: what a stored value that someone edited may hold. */
function clean(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return []
  const paths = value.filter((f): f is string => typeof f === 'string').map(f => f.trim()).filter(Boolean)
  return [...new Set(paths)].slice(0, max)
}

/** What a device's recent folders are stored under: folders of one device mean nothing on another. */
const keyFor = (device: string) => `magnetar.recentFolders.${device}`

/** The storage a page has, or undefined where the browser blocks it (the getter itself can throw). */
function pageStorage(): Pick<Storage, 'getItem' | 'setItem'> | undefined {
  try {
    return globalThis.localStorage
  } catch {
    return undefined
  }
}

/** The folders downloads were last saved to on `device`, most recent first. Empty without browser storage. */
export function readRecentFolders(device: string, storage = pageStorage()): string[] {
  try {
    const raw = storage?.getItem(keyFor(device))
    return raw ? clean(JSON.parse(raw), MAX_RECENT_FOLDERS) : []
  } catch {
    return []
  }
}

/** Remembers `folder` as the latest on `device`, and returns the list as it is now. Works without browser storage. */
export function rememberFolder(device: string, folder: string, storage = pageStorage()): string[] {
  const next = withRecent(readRecentFolders(device, storage), folder)
  try {
    storage?.setItem(keyFor(device), JSON.stringify(next))
  } catch {
    // Blocked or full: the list lives on in the page until it is reloaded.
  }
  return next
}

const trimEnd = (path: string) => path.trim().replace(/[\\/]+$/, '')

/**
 * The folders to offer for saving a download, the latest first: where the device's own downloads went (they
 * follow the owner to every dashboard), then what this browser remembers. The default folder is no choice to
 * remember, so it is left out.
 */
export function folderChoices(
  downloads: readonly { savePath: string; addedAt: string }[],
  stored: readonly string[],
  defaultFolder: string,
  max = MAX_RECENT_FOLDERS,
): string[] {
  const fromDevice = [...downloads].sort((a, b) => Date.parse(b.addedAt) - Date.parse(a.addedAt)).map(d => d.savePath)
  const all = [...fromDevice, ...stored].map(f => f.trim()).filter(f => f && trimEnd(f) !== trimEnd(defaultFolder))
  return [...new Set(all)].slice(0, max)
}

/** `remembered` when `browsable` says it can still be opened, else the default folder: no error for a folder that went away. */
export async function usableOrDefault(remembered: string, defaultFolder: string, browsable: (folder: string) => Promise<boolean>): Promise<string> {
  if (!remembered.trim() || trimEnd(remembered) === trimEnd(defaultFolder)) return defaultFolder
  try {
    return (await browsable(remembered)) ? remembered : defaultFolder
  } catch {
    return defaultFolder
  }
}
