import type { UpdateStatusDto } from '@magnetar/protocol'
import { describe, expect, it } from 'vitest'
import {
  answeredAttempt, expectsAway, installPhase, installTrouble, observedAttempt, RESTART_WITHIN_MS, restoredAttempt, startedAttempt, type AppView,
  type InstallAttempt,
} from './updateInstall.ts'

const t = (key: string, ...args: unknown[]) => [key, ...args].join('|')
const formatDate = (iso: string) => iso
const on = (running: string, installing = false): AppView => ({ online: true, running, installing })
const off: AppView = { online: false }

/** Follows an attempt through what the dashboard learns, each as [view, at ms], and says where it stands at the end. */
function follow(attempt: InstallAttempt | null, ...seen: [AppView, number][]) {
  let view: AppView = off
  let now = 0
  for (const [next, at] of seen) {
    attempt = observedAttempt(attempt, next, at)
    view = next
    now = at
  }
  return { attempt, phase: (at = now) => installPhase(attempt, view, at) }
}

describe('an update followed from the dashboard', () => {
  it('waits while the app installs and restarts, and ends when the app is back on another version', () => {
    const clicked = startedAttempt('1.2.3')
    expect(follow(clicked, [on('1.2.3'), 0]).phase()).toBe('installing')
    expect(follow(clicked, [on('1.2.3', true), 10]).phase()).toBe('installing')
    expect(follow(clicked, [on('1.2.3', true), 10], [off, 5000]).phase()).toBe('restarting')
    const back = follow(clicked, [on('1.2.3', true), 10], [off, 5000], [on('1.2.4'), 20_000])
    expect(back.attempt).toBeNull()
    expect(back.phase()).toBe('idle')
  })

  it('stops waiting for an app that stays away longer than a restart takes, at the limit and not before', () => {
    const away = follow(startedAttempt('1.2.3'), [on('1.2.3', true), 10], [off, 5000])
    expect(away.phase(5000 + RESTART_WITHIN_MS - 1)).toBe('restarting')
    expect(away.phase(5000 + RESTART_WITHIN_MS)).toBe('lost')
    expect(away.phase(5000 + 24 * 3600_000)).toBe('lost')
  })

  it('counts the time away from when the app first went, however often the dashboard hears it is still away', () => {
    const away = follow(startedAttempt('1.2.3'), [on('1.2.3', true), 0], [off, 1000], [off, 100_000], [off, 170_000])
    expect(away.phase(1000 + RESTART_WITHIN_MS)).toBe('lost')
  })

  it('says the update failed when the app is back on the version it had, and can be tried again', () => {
    const back = follow(startedAttempt('1.2.3'), [on('1.2.3', true), 10], [off, 5000], [on('1.2.3'), 9000])
    expect(back.phase()).toBe('failed')
    expect(back.phase(9000 + 10 * RESTART_WITHIN_MS)).toBe('failed')
    expect(follow(back.attempt, [on('1.2.3', true), 20_000]).phase()).toBe('installing')
  })

  it('says so too for an app that came back only after the dashboard had stopped waiting', () => {
    const late = follow(startedAttempt('1.2.3'), [on('1.2.3', true), 0], [off, 1000], [on('1.2.3'), 1000 + 2 * RESTART_WITHIN_MS])
    expect(late.phase()).toBe('failed')
  })

  it('says the update failed when the app gives up installing without going away', () => {
    expect(follow(startedAttempt('1.2.3'), [on('1.2.3', true), 10], [on('1.2.3'), 4000]).phase()).toBe('failed')
  })

  it('forgets a click the app never took up, but not one it did', () => {
    expect(answeredAttempt(follow(startedAttempt('1.2.3'), [on('1.2.3'), 5]).attempt)).toBeNull()
    expect(answeredAttempt(follow(startedAttempt('1.2.3'), [on('1.2.3', true), 5]).attempt)).not.toBeNull()
    expect(answeredAttempt(follow(startedAttempt('1.2.3'), [off, 5]).attempt)).not.toBeNull()
    expect(answeredAttempt(null)).toBeNull()
  })

  it('follows an update started elsewhere, so a second dashboard does not spin for ever either', () => {
    const elsewhere = follow(null, [on('1.2.3', true), 0], [off, 2000])
    expect(elsewhere.phase()).toBe('restarting')
    expect(elsewhere.phase(2000 + RESTART_WITHIN_MS)).toBe('lost')
  })

  it('follows nothing for an app that is merely offline or up to date', () => {
    expect(follow(null, [on('1.2.3'), 0], [off, 10], [on('1.2.3'), 20]).attempt).toBeNull()
    expect(follow(null, [off, 0]).phase(RESTART_WITHIN_MS * 2)).toBe('idle')
  })

  it('takes the version from the app when the click came before the app had said which one runs', () => {
    const early = follow(startedAttempt(null), [on('1.2.3', true), 0], [off, 10])
    expect(follow(early.attempt, [on('1.2.3'), 20]).phase()).toBe('failed')
    expect(follow(early.attempt, [on('1.2.4'), 20]).attempt).toBeNull()
  })
})

describe('the lost connection of an app that updates', () => {
  it('is expected while the update installs and the app restarts, so it is not reported', () => {
    const away = follow(startedAttempt('1.2.3'), [on('1.2.3', true), 10], [off, 5000])
    expect(expectsAway(away.phase())).toBe(true)
    expect(expectsAway(away.phase(5000 + RESTART_WITHIN_MS - 1))).toBe(true)
  })

  it('is reported as ever once the app has been away too long, came back, or no update runs', () => {
    const away = follow(startedAttempt('1.2.3'), [on('1.2.3', true), 10], [off, 5000])
    expect(expectsAway(away.phase(5000 + RESTART_WITHIN_MS))).toBe(false)
    expect(expectsAway(follow(away.attempt, [on('1.2.3'), 9000], [off, 10_000]).phase(10_000))).toBe(true)
    expect(expectsAway(follow(away.attempt, [on('1.2.4'), 9000], [off, 10_000]).phase())).toBe(false)
    expect(expectsAway(follow(null, [on('1.2.3'), 0], [off, 10]).phase())).toBe(false)
    expect(expectsAway('failed')).toBe(false)
  })
})

describe('an update followed across a reload of the page', () => {
  const kept = (attempt: InstallAttempt | null) => JSON.stringify(attempt)

  it('goes on waiting from when the app went away, and still gives up at the limit', () => {
    const away = follow(startedAttempt('1.2.3'), [on('1.2.3', true), 10], [off, 5000])
    const reloaded = restoredAttempt(kept(away.attempt), 60_000)
    expect(reloaded).toEqual({ from: '1.2.3', seen: true, offlineSince: 5000 })
    expect(installPhase(reloaded, off, 60_000)).toBe('restarting')
    expect(installPhase(reloaded, off, 5000 + RESTART_WITHIN_MS)).toBe('lost')
  })

  it('ends when the app reports the new version, and says failed when it reports the old one', () => {
    const reloaded = restoredAttempt(kept({ from: '1.2.3', seen: true, offlineSince: 5000 }), 60_000)
    expect(follow(reloaded, [on('1.2.4'), 70_000]).attempt).toBeNull()
    expect(follow(reloaded, [on('1.2.3'), 70_000]).phase()).toBe('failed')
  })

  it('never waits for ever for a click reloaded before the app answered: the limit runs from the reload', () => {
    const reloaded = restoredAttempt(kept(startedAttempt('1.2.3')), 1000)
    expect(installPhase(reloaded, off, 1000)).toBe('restarting')
    expect(installPhase(reloaded, off, 1000 + RESTART_WITHIN_MS)).toBe('lost')
    expect(follow(reloaded, [on('1.2.3'), 2000]).phase()).toBe('failed')
  })

  it('follows nothing when nothing, or nothing readable, was kept', () => {
    for (const text of [null, '', 'null', '{', '[]x', '7', '"1.2.3"', '{"from":7}', '{"offlineSince":5}']) expect(restoredAttempt(text, 0)).toBeNull()
  })

  it('does not trust a time away that is not a time, or is ahead of the clock', () => {
    for (const offlineSince of ['5', null, 1e99, 90_000]) {
      expect(restoredAttempt(JSON.stringify({ from: '1.2.3', seen: true, offlineSince }), 60_000)?.offlineSince).toBe(60_000)
    }
  })
})

describe('what an update that did not end well says', () => {
  const status = (patch: Partial<UpdateStatusDto>) => ({ currentVersion: '1.2.3', lastCheckProblem: null, lastCheckError: null, ...patch }) as UpdateStatusDto

  it('names the device that did not come back, or the app on its own dashboard', () => {
    expect(installTrouble(t, 'lost', status({}), 'Mac-Mini-M1', formatDate)).toBe('update.lostRemote|Mac-Mini-M1')
    expect(installTrouble(t, 'lost', null, null, formatDate)).toBe('update.lostLocal')
  })

  it('gives the app\'s reason when it has one, and the version still running when it has none', () => {
    expect(installTrouble(t, 'failed', status({ lastCheckProblem: 'install', lastCheckError: 'Update failed: Checksum mismatch' }), null, formatDate))
      .toBe('settings.installFailed|Checksum mismatch')
    expect(installTrouble(t, 'failed', status({ lastCheckProblem: 'offline' }), null, formatDate)).toBe('update.failed|1.2.3')
  })

  it('says nothing while the update runs or none is followed', () => {
    for (const phase of ['idle', 'installing', 'restarting'] as const) expect(installTrouble(t, phase, status({}), 'Mac', formatDate)).toBeNull()
  })
})
