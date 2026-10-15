import { expect, test } from '@playwright/test'

test('speed limits are checked as typed, saved on leaving the field, and kept', async ({ page }) => {
  await page.goto('/settings/downloads')
  // The usual limits come before the slower ones.
  const download = () => page.getByRole('textbox', { name: 'Download, MB/s' }).first()
  await download().fill('0.01')
  await download().press('Enter')
  await expect(page.getByText('At least 33 KB/s, or blank for no limit.')).toBeVisible()
  await download().fill('5')
  await download().press('Enter')
  await expect(page.getByText('At least 33 KB/s')).toHaveCount(0)
  await page.reload()
  await expect(download()).toHaveValue('5')
  await download().fill('')
  await download().press('Enter')
  await page.reload()
  await expect(download()).toHaveValue('')
})

test('the dashboard speaks the chosen language, and back', async ({ page }) => {
  await page.goto('/settings')
  await page.getByLabel('Language').selectOption('de')
  await expect(page.getByRole('link', { name: 'Einstellungen' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Merkliste' })).toBeVisible()
  await page.getByLabel('Sprache').selectOption('en')
  await expect(page.getByRole('link', { name: 'Settings' })).toBeVisible()
})

test('a series and a watch are set up from the Watchlist page', async ({ page }) => {
  await page.goto('/series')
  await page.getByRole('button', { name: 'Add a series' }).first().click()
  const dialog = page.locator('dialog[open]')
  await dialog.getByLabel('Search for').fill('Example Show')
  await dialog.getByRole('radio', { name: '1080p' }).click()
  await dialog.getByRole('button', { name: 'Add a series' }).click()
  const card = page.locator('li').filter({ hasText: 'Example Show' })
  await expect(card).toContainText('1080p')
  await expect(card).toContainText('Waiting for episode 1')

  await page.getByRole('radio', { name: /Films & more/ }).click()
  await expect(page).toHaveURL(/\/series\/releases$/)
  await page.getByRole('button', { name: 'Wait for a release' }).first().click()
  const watch = page.locator('dialog[open]')
  await watch.getByLabel('What to look for').fill('x')
  await expect(watch.getByRole('button', { name: 'Wait for a release' })).toBeDisabled()
  await watch.getByRole('button', { name: 'Cancel' }).click()
})
