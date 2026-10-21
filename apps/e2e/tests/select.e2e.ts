import { expect, test, type Locator, type Page } from '@playwright/test'
import { serveDevice } from '../fixtures/device.ts'
import { combobox, listbox as list } from '../fixtures/select.ts'

/** The language menu in Settings. */
const language = (page: Page) => combobox(page, 'Language')

/** The source menu on Search: seven options, two starting with T. */
const source = (page: Page) => combobox(page, 'Source')
const sourceParam = (page: Page) => new URL(page.url()).searchParams.get('source')

/** The menu marks `option` as the one the keys are on, by the option's own (non-empty) id. */
async function expectActive(page: Page, menu: Locator, option: string) {
  const id = await list(page).getByRole('option', { name: option }).getAttribute('id')
  expect(id, option).toBeTruthy()
  await expect(menu).toHaveAttribute('aria-activedescendant', id!)
}

test('a click opens the list with the choice marked, and an option changes it and closes the list', async ({ page }) => {
  const device = await serveDevice(page, { design: 'set-general' })
  await page.goto('/settings')
  const menu = language(page)
  await expect(menu).toHaveText('English')
  await expect(menu).toHaveAttribute('aria-expanded', 'false')
  await expect(page.locator('select')).toHaveCount(0)

  await menu.click()
  await expect(menu).toHaveAttribute('aria-expanded', 'true')
  await expect(list(page).getByRole('option')).toHaveText(['English', 'Polski'])
  await expect(list(page).getByRole('option', { name: 'English' })).toHaveAttribute('aria-selected', 'true')
  // Each language's own name is read in that language.
  await expect(list(page).getByRole('option', { name: 'Polski' })).toHaveAttribute('lang', 'pl')

  await list(page).getByRole('option', { name: 'Polski' }).click()
  await expect(list(page)).toBeHidden()
  await expect(combobox(page, 'Język')).toHaveText('Polski')
  await expect(combobox(page, 'Język')).toBeFocused()
  await expect.poll(() => device.settings().language).toBe('pl')
})

test('by keyboard: arrows open and move without choosing, Enter chooses, Escape changes nothing', async ({ page }) => {
  await serveDevice(page, { design: 'search' })
  await page.goto('/search/sintel')
  const menu = source(page)
  await menu.focus()
  await page.keyboard.press('ArrowDown')
  await expect(list(page)).toBeVisible()
  // Opening marks the current choice; nothing is chosen yet.
  await expectActive(page, menu, 'All sources')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await expectActive(page, menu, 'Torrents-CSV')
  await page.keyboard.press('Escape')
  await expect(list(page)).toBeHidden()
  await expect(menu).toHaveText('All sources')
  await expect(menu).toBeFocused()
  expect(sourceParam(page)).toBeNull()

  await page.keyboard.press('End')
  await expectActive(page, menu, 'RARBG')
  await page.keyboard.press('Home')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(list(page)).toBeHidden()
  await expect(menu).toHaveText('The Pirate Bay')
  await expect.poll(() => sourceParam(page)).toBe('tpb')
})

test('typing a letter finds the option it starts, and the same letter again the next one', async ({ page }) => {
  await serveDevice(page, { design: 'search' })
  await page.goto('/search/sintel')
  const menu = source(page)
  await menu.focus()
  await page.keyboard.press('t')
  await expect(list(page)).toBeVisible()
  await expectActive(page, menu, 'The Pirate Bay')
  await page.keyboard.press('t')
  await expectActive(page, menu, 'Torrents-CSV')
  // Tab takes the marked option and moves on, as a system menu does.
  await page.keyboard.press('Tab')
  await expect(list(page)).toBeHidden()
  await expect(menu).toHaveText('Torrents-CSV')
  await expect.poll(() => sourceParam(page)).toBe('csv')
})

test('a space typed in the middle of a word is part of it, not a choice', async ({ page }) => {
  await serveDevice(page, { design: 'downloads' })
  await page.goto('/')
  const sort = combobox(page, 'Sort downloads')
  await sort.focus()
  await page.keyboard.type('oldest f', { delay: 30 })
  await expect(list(page)).toBeVisible()
  await expectActive(page, sort, 'Oldest first')
  await expect(sort).toHaveText('Newest first')
  // After a pause Space is a choice again.
  await page.waitForTimeout(800)
  await page.keyboard.press(' ')
  await expect(list(page)).toBeHidden()
  await expect(sort).toHaveText('Oldest first')
})

test('leaving it, by a click elsewhere, closes the list and changes nothing', async ({ page }) => {
  const device = await serveDevice(page, { design: 'set-general' })
  await page.goto('/settings')
  await language(page).click()
  await expect(list(page)).toBeVisible()
  await page.getByRole('heading', { name: 'Settings', level: 1 }).click()
  await expect(list(page)).toBeHidden()
  await expect(language(page)).toHaveText('English')
  expect(device.log.filter(c => c.method === 'settings.update')).toEqual([])
})

test('near the bottom of the screen the list opens above, and stays on the screen', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 420 })
  await serveDevice(page, { design: 'set-general' })
  await page.goto('/settings')
  const menu = language(page)
  await menu.evaluate(element => { scrollBy(0, element.getBoundingClientRect().bottom - innerHeight + 20) })
  await menu.click()
  const [button, popup] = await Promise.all([menu.boundingBox(), list(page).boundingBox()])
  expect(popup!.y + popup!.height).toBeLessThanOrEqual(button!.y + 1)
  expect(popup!.y).toBeGreaterThanOrEqual(0)
})

test('on a phone the sort menu at the right edge opens inward and the page never scrolls sideways', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 })
  await serveDevice(page, { design: 'downloads' })
  await page.goto('/')
  const sort = combobox(page, 'Sort downloads')
  await sort.click()
  const popup = await list(page).boundingBox()
  expect(popup!.x).toBeGreaterThanOrEqual(0)
  expect(popup!.x + popup!.width).toBeLessThanOrEqual(390)
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0)
  await list(page).getByRole('option').last().click()
  await expect(list(page)).toBeHidden()
})

test('in a form whose fields are labels, choosing an option chooses it once and leaves the list closed', async ({ page }) => {
  await serveDevice(page, { design: 'watchlist' })
  await page.goto('/series')
  await page.getByRole('button', { name: 'Wait for a release' }).first().click()
  const every = combobox(page, 'Check every')
  const before = await every.innerText()
  await every.click()
  const other = list(page).getByRole('option').filter({ hasNotText: before }).first()
  const name = await other.innerText()
  await other.click()
  await expect(list(page)).toBeHidden()
  await expect(every).toHaveText(name)
  await expect(every).toHaveAttribute('aria-expanded', 'false')
})

test('clicking the name above a group of choices changes nothing', async ({ page }) => {
  await serveDevice(page, { design: 'watchlist' })
  await page.goto('/series')
  await page.getByRole('button', { name: 'Wait for a release' }).first().click()
  const dialog = page.locator('dialog[open]')
  const resolution = dialog.getByRole('radiogroup', { name: 'Resolution' })
  await resolution.getByRole('radio', { name: '1080p' }).click()
  await expect(resolution.getByRole('radio', { name: '1080p' })).toHaveAttribute('aria-checked', 'true')
  // A label around the group passed this click to its first choice.
  await dialog.getByText('Resolution', { exact: true }).click()
  await expect(resolution.getByRole('radio', { name: '1080p' })).toHaveAttribute('aria-checked', 'true')
})

test('a language saved before it was dropped shows as English, in an English page', async ({ page }) => {
  await serveDevice(page, { design: 'set-general', language: 'de' })
  await page.goto('/settings')
  await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible()
  await expect(language(page)).toHaveText('English')
})
