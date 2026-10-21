import { expect, test } from '@playwright/test'
import { serveDevice } from '../fixtures/device.ts'
import { combobox, listbox } from '../fixtures/select.ts'

test('in a dialog the list stays inside the dialog body, though the screen has room below it', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1200 })
  await serveDevice(page, { design: 'watchlist' })
  await page.goto('/series')
  await page.getByRole('button', { name: 'Wait for a release' }).first().click()
  const body = page.locator('dialog[open] .infall-dialog-body')
  const every = combobox(page, 'Check every')
  // Scroll the body, where it scrolls, so the menu sits at its foot.
  await body.evaluate((element, menu) => {
    element.scrollTop += menu.getBoundingClientRect().bottom - element.getBoundingClientRect().bottom + 4
  }, await every.elementHandle())
  await every.click()
  // The screen has room below the menu for the whole list; the dialog body does not.
  expect(1200 - (await every.boundingBox())!.y - 46).toBeGreaterThan(296)
  const [area, popup] = await Promise.all([body.boundingBox(), listbox(page).boundingBox()])
  expect(popup!.y).toBeGreaterThanOrEqual(area!.y - 1)
  expect(popup!.y + popup!.height).toBeLessThanOrEqual(area!.y + area!.height + 1)
})
