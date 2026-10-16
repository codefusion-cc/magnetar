import { isOutdated } from '@codefusion-cc/app-update'
import type { CloudDeviceDto, ReleasePlatform } from '@magnetar/protocol/cloud'
import type { Translate } from '../lib/i18n.tsx'
import { downloadDay } from '../lib/downloadPresentation.ts'
import type { StarState } from '../lib/deviceStar.ts'

export const PLATFORM_NAMES: Record<ReleasePlatform, string> = { macos: 'macOS', windows: 'Windows', linux: 'Linux' }

/** A system's name as people know it; anything the app may report later as it is. */
export function platformName(platform: string): string {
  return PLATFORM_NAMES[platform as ReleasePlatform] ?? platform
}

/** A computer's star on the list: lit when this browser can open it now, far when it can't yet, out when offline. */
export function computerStar(device: Pick<CloudDeviceDto, 'online'>, linked: boolean): StarState {
  return !device.online ? 'out' : linked ? 'lit' : 'far'
}

/**
 * The one line under a computer's name: whether it is there, then what it runs or why this browser can't open it.
 * "Online. macOS, Magnetar 1.2.2", "Offline since yesterday, 23:10. Runs Magnetar 1.1.0, an update is waiting."
 */
export function computerLine(t: Translate, language: string, device: Pick<CloudDeviceDto, 'online' | 'lastSeenAt' | 'platform' | 'version'>,
  linked: boolean, latest: string | null, now = new Date()): string {
  const status = device.online ? t('devices.statusOnline')
    : device.lastSeenAt && !Number.isNaN(new Date(device.lastSeenAt).getTime()) ? t('devices.statusOffline', downloadDay(language, device.lastSeenAt, true, now))
    : t('devices.statusOfflineNever')
  if (!linked) return `${status} ${t('devices.detailNotLinked')}`
  const update = latest !== null && isOutdated(device.version, latest)
  const detail = !device.version ? (device.online && device.platform ? platformName(device.platform) : '')
    : device.online ? t(update ? 'devices.detailOnlineUpdate' : 'devices.detailOnline', platformName(device.platform), device.version)
    : t(update ? 'devices.detailOfflineUpdate' : 'devices.detailOffline', device.version)
  return detail ? `${status} ${detail}` : status
}
