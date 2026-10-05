import { DOWNLOAD_STATUSES } from '@magnetar/protocol'
import { describe, expect, test } from 'vitest'
import { countViews, DEFAULT_DOWNLOAD_VIEW, DOWNLOAD_VIEWS, inView } from './downloadViews.ts'
import { pickParam } from './urlState.ts'

describe('the Downloads views', () => {
  test('every status is in exactly one of Active and Finished, and always in All', () => {
    for (const status of DOWNLOAD_STATUSES) {
      expect([inView(status, 'active'), inView(status, 'finished')].filter(Boolean)).toHaveLength(1)
      expect(inView(status, 'all')).toBe(true)
    }
  })

  test('failed, paused, queued, checking and downloading are Active; completed and seeding are Finished', () => {
    for (const s of ['Error', 'Paused', 'Queued', 'FetchingMetadata', 'Downloading'] as const) expect(inView(s, 'active')).toBe(true)
    for (const s of ['Completed', 'Seeding'] as const) expect(inView(s, 'finished')).toBe(true)
  })

  test('counts add up per view', () => {
    const list = ['Downloading', 'Paused', 'Error', 'Seeding', 'Completed', 'Completed'].map((status, id) => ({ id, status })) as { id: number; status: (typeof DOWNLOAD_STATUSES)[number] }[]
    expect(countViews(list)).toEqual({ active: 3, finished: 3, all: 6 })
    expect(countViews([])).toEqual({ active: 0, finished: 0, all: 0 })
  })

  test('the page opens on Active, also for an address with an unknown view', () => {
    expect(DEFAULT_DOWNLOAD_VIEW).toBe('active')
    expect(pickParam(new URLSearchParams(''), 'view', DOWNLOAD_VIEWS, DEFAULT_DOWNLOAD_VIEW)).toBe('active')
    expect(pickParam(new URLSearchParams('view=sideways'), 'view', DOWNLOAD_VIEWS, DEFAULT_DOWNLOAD_VIEW)).toBe('active')
    expect(pickParam(new URLSearchParams('view=finished'), 'view', DOWNLOAD_VIEWS, DEFAULT_DOWNLOAD_VIEW)).toBe('finished')
  })
})
