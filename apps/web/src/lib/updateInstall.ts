import type { UpdateStatusDto } from '@magnetar/protocol'
import type { Translate } from './i18n.tsx'
import { releasesProblemText } from './releases.ts'

/**
 * How long an app may stay away while it updates before the dashboard stops waiting: the helper gives the app a
 * minute to exit and each start half a minute, and the new version then has to reach the relay.
 */
export const RESTART_WITHIN_MS = 3 * 60_000

/** How long after its start a reloaded page still takes up an update it had followed; an older one is forgotten. */
export const RELOAD_FOLLOWS_MS = 30 * 60_000

/** One update the dashboard is following, from the click (or the app saying it installs) to its end. */
export interface InstallAttempt {
  /** The version the app ran when the update started; null until the app says. */
  from: string | null
  /** The app said it installs, or went away: until then a click may still come to nothing. */
  seen: boolean
  /** Since when the app has been away, in ms; null while it answers. */
  offlineSince: number | null
  /** When the update was started or first seen, in ms. */
  startedAt: number
}

/** What the dashboard last learned of the app: nothing counts as known while it is away or has not reported since. */
export type AppView = { online: false } | { online: true; running: string; installing: boolean }

/**
 * Where an update stands. `installing`: the app downloads and checks it. `restarting`: the app is away, as it must
 * be for a while. `failed`: it is back on the version it had. `lost`: it has been away longer than a restart takes.
 */
export type InstallPhase = 'idle' | 'installing' | 'restarting' | 'failed' | 'lost'

/** A click on Update: followed from now on, whatever the app does next. */
export const startedAttempt = (running: string | null, now: number): InstallAttempt => ({ from: running, seen: false, offlineSince: null, startedAt: now })

/**
 * The attempt after a click on Update (or Try again) when `phase` is where the update stood: one that is still under
 * way goes on, anything else (none, failed, lost) starts afresh, so its end is not taken for the old one's.
 */
export const clickedAttempt = (attempt: InstallAttempt | null, phase: InstallPhase, running: string | null, now: number): InstallAttempt =>
  attempt && expectsAway(phase) ? attempt : startedAttempt(running, now)

/** The attempt after the app answered the install call: one the app never took up (nothing to install) is over. */
export const answeredAttempt = (attempt: InstallAttempt | null): InstallAttempt | null => (attempt?.seen ? attempt : null)

/**
 * The attempt after the dashboard learned `view` at `now`. An app that installs is followed even without a click
 * here (another browser, the app's own notice); an attempt ends when the app reports another version.
 */
export function observedAttempt(attempt: InstallAttempt | null, view: AppView, now: number): InstallAttempt | null {
  if (!view.online) return attempt && { ...attempt, seen: true, offlineSince: attempt.offlineSince ?? now }
  if (!attempt) return view.installing ? { from: view.running, seen: true, offlineSince: null, startedAt: now } : null
  const from = attempt.from ?? view.running
  if (view.running !== from) return null
  return { ...attempt, from, seen: attempt.seen || view.installing, offlineSince: null }
}

/** Where `attempt` stands for an app last seen as `view`. */
export function installPhase(attempt: InstallAttempt | null, view: AppView, now: number): InstallPhase {
  if (!attempt) return 'idle'
  if (!view.online) {
    if (attempt.offlineSince === null) return 'installing'
    return now - attempt.offlineSince >= RESTART_WITHIN_MS ? 'lost' : 'restarting'
  }
  return view.installing || !attempt.seen ? 'installing' : 'failed'
}

/** While an update installs or the app restarts, its going away is expected and not a lost connection to report. */
export const expectsAway = (phase: InstallPhase): boolean => phase === 'installing' || phase === 'restarting'

/** Where this tab keeps the update it follows on one device (by the browser's key for it), so a reload goes on waiting. */
export const attemptKey = (keyId: string | null): string => `magnetar-update-install:${keyId ?? 'local'}`

/**
 * The attempt a reload of the page left in `text`, or null when there is none, it is unreadable, or the update began
 * more than {@link RELOAD_FOLLOWS_MS} ago (a tab left open for days must not hide today's lost connection). The page
 * knows nothing of the app until it reports again, so the attempt goes on as one the app took up and that is away,
 * since `now` unless it was away already.
 */
export function restoredAttempt(text: string | null, now: number): InstallAttempt | null {
  try {
    const stored: unknown = JSON.parse(text ?? 'null')
    if (typeof stored !== 'object' || stored === null) return null
    const { from, offlineSince, startedAt } = stored as Record<string, unknown>
    if (from !== null && typeof from !== 'string') return null
    if (typeof startedAt !== 'number' || !Number.isFinite(startedAt) || now - startedAt >= RELOAD_FOLLOWS_MS) return null
    const since = typeof offlineSince === 'number' && Number.isFinite(offlineSince) && offlineSince <= now ? offlineSince : now
    return { from, seen: true, offlineSince: since, startedAt: Math.min(startedAt, now) }
  } catch {
    return null
  }
}

/** `attempt` with no time ahead of `now`: a clock set back would otherwise stretch the wait by the difference. */
export function clockCorrected(attempt: InstallAttempt, now: number): InstallAttempt {
  if (attempt.startedAt <= now && (attempt.offlineSince ?? 0) <= now) return attempt
  return { ...attempt, startedAt: Math.min(attempt.startedAt, now), offlineSince: attempt.offlineSince === null ? null : Math.min(attempt.offlineSince, now) }
}

/** What to tell the person about an update that did not end well, or null while there is nothing to say. */
export function installTrouble(
  t: Translate, phase: InstallPhase, updates: UpdateStatusDto | null, device: string | null,
  formatDate: (iso: string, withTime?: boolean) => string,
): string | null {
  if (phase === 'lost') return device ? t('update.lostRemote', device) : t('update.lostLocal')
  if (phase !== 'failed' || !updates) return null
  return updates.lastCheckProblem === 'install'
    ? releasesProblemText(t, 'install', null, formatDate, updates.lastCheckError)
    : t('update.failed', updates.currentVersion)
}
