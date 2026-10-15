import { expect, test, type Page } from '@playwright/test'
import { serveDevice } from '../fixtures/device.ts'
import { combobox, listbox as list } from '../fixtures/select.ts'

/** The language menu in Settings. */
const language = (page: Page) => combobox(page, 'Language')

test('a click opens the list with the choice marked, and an option changes it and closes the list', async ({ page }) => {
  const device = await serveDevice(page, { design: 'set-general' })
  await page.goto('/settings')
  const menu = language(page)
  await expect(menu).toHaveText('English')
  await expect(menu).toHaveAttribute('aria-expanded', 'false')
  await expect(page.locator('select')).toHaveCount(0)

  await menu.click()
  await expect(menu).toHaveAttribute('aria-expanded', 'true')
  await expect(list(page).getByRole('option')).toHaveText(['English', 'Deutsch', 'Español', 'Français', 'Italiano', 'Polski', 'Português', 'Русский'])
  await expect(list(page).getByRole('option', { name: 'English' })).toHaveAttribute('aria-selected', 'true')
  // Each language's own name is read in that language.
  await expect(list(page).getByRole('option', { name: 'Русский' })).toHaveAttribute('lang', 'ru')

  await list(page).getByRole('option', { name: 'Deutsch' }).click()
  await expect(list(page)).toBeHidden()
  await expect(combobox(page, 'Sprache')).toHaveText('Deutsch')
  await expect(combobox(page, 'Sprache')).toBeFocused()
  await expect.poll(() => device.settings().language).toBe('de')
})

test('by keyboard: arrows open and move without choosing, Enter chooses, Escape changes nothing', async ({ page }) => {
  const device = await serveDevice(page, { design: 'set-general' })
  await page.goto('/settings')
  const menu = language(page)
  await menu.focus()
  await page.keyboard.press('ArrowDown')
  await expect(list(page)).toBeVisible()
  // Opening marks the current choice; nothing is chosen yet.
  await expect(menu).toHaveAttribute('aria-activedescendant', await list(page).getByRole('option', { name: 'English' }).getAttribute('id') ?? '')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await expect(menu).toHaveAttribute('aria-activedescendant', await list(page).getByRole('option', { name: 'Español' }).getAttribute('id') ?? '')
  await page.keyboard.press('Escape')
  await expect(list(page)).toBeHidden()
  await expect(menu).toHaveText('English')
  await expect(menu).toBeFocused()

  await page.keyboard.press('End')
  await expect(menu).toHaveAttribute('aria-activedescendant', await list(page).getByRole('option', { name: 'Русский' }).getAttribute('id') ?? '')
  await page.keyboard.press('Home')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(combobox(page, 'Sprache')).toHaveText('Deutsch')
  await expect.poll(() => device.settings().language).toBe('de')
  expect(device.log.filter(c => c.method === 'settings.update').length).toBe(1)
})

test('typing a letter finds the language it starts, and the same letter again the next one', async ({ page }) => {
  await serveDevice(page, { design: 'set-general' })
  await page.goto('/settings')
  const menu = language(page)
  await menu.focus()
  await page.keyboard.press('p')
  await expect(list(page)).toBeVisible()
  await expect(menu).toHaveAttribute('aria-activedescendant', await list(page).getByRole('option', { name: 'Polski' }).getAttribute('id') ?? '')
  await page.keyboard.press('p')
  await expect(menu).toHaveAttribute('aria-activedescendant', await list(page).getByRole('option', { name: 'Português' }).getAttribute('id') ?? '')
  // Tab takes the marked option and moves on, as a system menu does.
  await page.keyboard.press('Tab')
  await expect(list(page)).toBeHidden()
  await expect(combobox(page, 'Idioma')).toHaveText('Português')
})

test('a space typed in the middle of a word is part of it, not a choice', async ({ page }) => {
  await serveDevice(page, { design: 'downloads' })
  await page.goto('/')
  const sort = combobox(page, 'Sort downloads')
  await sort.focus()
  await page.keyboard.type('oldest f', { delay: 30 })
  await expect(list(page)).toBeVisible()
  await expect(sort).toHaveAttribute('aria-activedescendant', await list(page).getByRole('option', { name: 'Oldest first' }).getAttribute('id') ?? '')
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
