import { useCallback, useEffect, useState } from 'react'
import { cloud, CloudError } from '../lib/cloudApi.ts'
import { listDeviceKeys } from '../lib/keyStore.ts'
import { useAccount } from './CloudApp.tsx'

/**
 * The account's computers and which of them this browser holds a key for. `devices` starts from the list last
 * fetched, so a page can show at once; `state` says whether the list on hand is from this visit. `reload()` reads it
 * again and keeps a list already read when that fails; `reloadOn` changing (another address) reads it as new. A
 * session that ended shows as signed out rather than as a list going stale.
 */
export function useComputers(reloadOn?: string) {
  const { refresh } = useAccount()
  const [devices, setDevices] = useState(() => cloud.knownDevices())
  const [linked, setLinked] = useState<ReadonlySet<string>>(() => new Set())
  const [state, setState] = useState<'loading' | 'fresh' | 'failed'>('loading')
  const reload = useCallback((keep = true) => {
    let cancelled = false
    setState(now => (keep && now === 'fresh' ? now : 'loading'))
    Promise.all([cloud.devices(), listDeviceKeys().catch(() => [])]).then(([list, keys]) => {
      if (cancelled) return
      setDevices(list)
      setLinked(new Set(keys.map(k => k.deviceId)))
      setState('fresh')
    }, error => {
      if (cancelled) return
      if (error instanceof CloudError && error.status === 401) void refresh()
      setState(now => (now === 'fresh' ? now : 'failed'))
    })
    return () => { cancelled = true }
  }, [refresh])
  useEffect(() => reload(false), [reload, reloadOn])
  return { devices, linked, state, reload, setDevices }
}
