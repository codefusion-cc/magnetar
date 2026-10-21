import type { Page } from '@playwright/test'

/**
 * Gives the browser a stored key for each computer, as linking leaves it in the dashboard's key store
 * (`apps/web/src/lib/keyStore.ts`): the database `magnetar`, store `deviceKeys`, one HMAC key per device.
 */
export async function seedDeviceKeys(page: Page, keys: readonly { deviceId: string; keyId: string }[], raw: readonly number[]) {
  await page.addInitScript(async ([keys, raw]) => {
    const key = await crypto.subtle.importKey('raw', new Uint8Array(raw), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('magnetar', 1)
      request.onupgradeneeded = () => request.result.createObjectStore('deviceKeys', { keyPath: 'deviceId' })
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const db = request.result
        const tx = db.transaction('deviceKeys', 'readwrite')
        for (const { deviceId, keyId } of keys) tx.objectStore('deviceKeys').put({ deviceId, keyId, key, linkedAt: '2026-01-01T00:00:00Z' })
        tx.oncomplete = () => { db.close(); resolve() }
        tx.onerror = () => reject(tx.error)
      }
    })
  }, [keys, raw] as const)
}
