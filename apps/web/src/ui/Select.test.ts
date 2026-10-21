import { expect, test } from 'vitest'
import { listPlace } from './Select.tsx'

const button = (top: number) => ({ top, bottom: top + 40, left: 100, width: 200 })

test('opens below with its full height where there is room', () => {
  expect(listPlace(button(100), { top: 0, bottom: 900 }, 1200)).toEqual({ above: false, end: false, height: 288 })
})

test('a button near the bottom of a dialog body opens above, though the screen has room below', () => {
  // The body runs from 200 to 600 on a 900px screen; the button sits at its foot.
  expect(listPlace(button(540), { top: 200, bottom: 600 }, 1200)).toEqual({ above: true, end: false, height: 288 })
})

test('short of room on both sides it shrinks to the larger side, to no less than 120px', () => {
  expect(listPlace(button(300), { top: 200, bottom: 540 }, 1200)).toEqual({ above: false, end: false, height: 192 })
  expect(listPlace(button(300), { top: 250, bottom: 400 }, 1200)).toEqual({ above: false, end: false, height: 120 })
})

test('a button right of the middle opens toward the middle', () => {
  expect(listPlace({ ...button(100), left: 900 }, { top: 0, bottom: 900 }, 1200).end).toBe(true)
  expect(listPlace({ ...button(100), left: 501 }, { top: 0, bottom: 900 }, 1200).end).toBe(true)
  expect(listPlace({ ...button(100), left: 500 }, { top: 0, bottom: 900 }, 1200).end).toBe(false)
})
