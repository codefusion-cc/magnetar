/** The key prefixes of what this browser keeps for each device it has shown, followed by the device's name. */
export const RECENT_FOLDERS_PREFIX = 'magnetar.recentFolders.'
export const DOWNLOAD_SORT_PREFIX = 'magnetar.downloadSort.'

/** The browser's local storage, or undefined where it is blocked (the getter itself can throw). */
export function pageStorage(): Storage | undefined {
  try {
    return globalThis.localStorage
  } catch {
    return undefined
  }
}

/**
 * Removes what this browser kept for one device (its recent folders and download order), or for every device when none
 * is named: the paths and the device's name must not outlive the sign-in or the device on a browser others use.
 * Does nothing where storage is blocked.
 */
export function forgetDevicePreferences(device?: string, storage: Pick<Storage, 'removeItem' | 'key' | 'length'> | undefined = pageStorage()): void {
  try {
    if (!storage) return
    if (device !== undefined) {
      storage.removeItem(RECENT_FOLDERS_PREFIX + device)
      storage.removeItem(DOWNLOAD_SORT_PREFIX + device)
      return
    }
    const keys: string[] = []
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i)
      if (key?.startsWith(RECENT_FOLDERS_PREFIX) || key?.startsWith(DOWNLOAD_SORT_PREFIX)) keys.push(key)
    }
    for (const key of keys) storage.removeItem(key)
  } catch {
    // Blocked: there is nothing this page could have stored either.
  }
}
