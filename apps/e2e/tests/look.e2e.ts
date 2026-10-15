import { formatHex, lookColors } from '@codefusion-cc/ui/looks'
import { expect, test, type Page } from '@playwright/test'
import infall from '../../web/src/looks/infall.ts'
import { pick } from '../fixtures/select.ts'

/** The look's page ground in `mode`, as `pageGround` reads it. */
function groundIn(mode: 'light' | 'dark'): string {
  const hex = formatHex(lookColors(infall, mode).get('--cf-page')!)
  return `rgb(${[1, 3, 5].map(at => parseInt(hex.slice(at, at + 2), 16)).join(', ')})`
}
const ground = { light: groundIn('light'), dark: groundIn('dark') }

/** The body's background as it is painted, in sRGB: a computed colour may be written in lab() or oklch(). */
const pageGround = (page: Page) =>
  page.evaluate(() => {
    const context = document.createElement('canvas').getContext('2d')!
    context.fillStyle = getComputedStyle(document.body).backgroundColor
    context.fillRect(0, 0, 1, 1)
    const [r, g, b] = context.getImageData(0, 0, 1, 1).data
    return `rgb(${r}, ${g}, ${b})`
  })

test('the page asks nothing of another host: fonts and styles come from the app', async ({ page, baseURL }) => {
  const elsewhere: string[] = []
  page.on('request', request => {
    const url = request.url()
    if (!url.startsWith(baseURL!) && !url.startsWith('data:') && !url.startsWith('blob:')) elsewhere.push(url)
  })
  for (const path of ['/downloads', '/search', '/series', '/files', '/settings']) {
    await page.goto(path)
    await page.getByRole('heading', { level: 1 }).first().waitFor()
    await page.evaluate(() => document.fonts.ready)
  }
  expect(elsewhere).toEqual([])
})

for (const [stored, scheme, expected] of [
  ['light', 'dark', ground.light],
  ['dark', 'light', ground.dark],
  ['system', 'dark', ground.dark],
  ['system', 'light', ground.light],
] as const) {
  test(`a stored ${stored} theme with the system ${scheme} paints its ground before the page's scripts run`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme })
    await page.addInitScript(mode => localStorage.setItem('magnetar-theme', mode), stored)
    // Only the theme's own script (/theme.js, first in <head>) runs: the dashboard's code never arrives.
    await page.route(/\/assets\/.*\.js$/, route => route.abort())
    await page.goto('/downloads')
    expect(await pageGround(page)).toBe(expected)
  })
}

test('headings are set in Unbounded in Polish and Russian, not in a fallback', async ({ page }) => {
  /** The heading's first font, and the letters of its text and `extra` that no loaded Unbounded face covers. */
  const heading = (extra = '') =>
    page.getByRole('heading', { level: 1 }).first().evaluate(async (h, more) => {
      const text = (h.textContent ?? '') + more
      await document.fonts.load('500 28px Unbounded', text)
      const covers = (range: string, point: number) =>
        range.split(',').some(part => {
          const [from, to = from] = part.trim().replace(/^U\+/i, '').split('-')
          return point >= parseInt(from!, 16) && point <= parseInt(to!, 16)
        })
      const faces = [...document.fonts].filter(face => face.family.replaceAll('"', '') === 'Unbounded' && face.status === 'loaded')
      const missing = [...new Set(text.replace(/\s/g, ''))].filter(letter => !faces.some(face => covers(face.unicodeRange, letter.codePointAt(0)!)))
      return { family: getComputedStyle(h).fontFamily.split(',')[0]!.replaceAll('"', ''), missing }
    }, extra)

  await page.goto('/settings')
  try {
    await pick(page, 'Language', 'Polski')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ustawienia')
    expect(await heading('ąćęłńóśźżĄĆĘŁŃÓŚŹŻ')).toEqual({ family: 'Unbounded', missing: [] })

    await pick(page, 'Język', 'Русский')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/[\u0400-\u04FF]/)
    expect(await heading('ЁЖЩЮЯёжщюя')).toEqual({ family: 'Unbounded', missing: [] })
  } finally {
    await pick(page, /^(Language|Język|Язык)$/, 'English')
  }
})
