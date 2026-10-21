import { expect, test } from '@playwright/test'
import { serveDevice } from '../fixtures/device.ts'
import { expectNoInvisibleClickTargets, expectVisibleTabStops } from '@codefusion-cc/testing/playwright'

test('on a phone the tab bar moves between pages and the theme follows the choice', async ({ page }) => {
  await page.goto('/')
  const tabs = page.getByRole('navigation', { name: 'Menu', exact: true })
  await tabs.getByRole('link', { name: 'Settings' }).click()
  await expect(page).toHaveURL(/\/settings/)
  await page.getByRole('radio', { name: 'Dark' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'magnetar-dark')
  await page.getByRole('radio', { name: 'Light' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'magnetar-light')
  await tabs.getByRole('link', { name: 'Downloads' }).click()
  await expect(page.getByRole('heading', { name: 'Downloads', exact: true })).toBeVisible()
  const width = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(width, 'no sideways scrolling').toBeLessThanOrEqual(0)
})

test('on a phone the switch sits in the top row beside the computer and flips the theme', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' })
  await page.goto('/')
  const header = page.getByRole('banner'), html = page.locator('html')
  const toDark = header.getByRole('button', { name: 'Switch to dark mode', exact: true })
  const box = (await toDark.boundingBox())!, viewport = page.viewportSize()!
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width)
  expect(box.width).toBeGreaterThanOrEqual(44)
  await toDark.click()
  await expect(html).toHaveAttribute('data-theme', 'magnetar-dark')
  await expect(header.getByRole('button', { name: 'Switch to light mode', exact: true })).toBeVisible()
})

test('at 390px every tab stays inside the viewport after scrolling Settings to the bottom', async ({ page }) => {
  await serveDevice(page)
  await page.setViewportSize({ width: 390, height: 700 })
  await page.goto('/settings')
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeGreaterThan(700)
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  const tabs = page.getByRole('navigation', { name: 'Menu', exact: true })
  const inside = async () => {
    const box = await tabs.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.y).toBeGreaterThanOrEqual(0)
    expect(box!.y + box!.height).toBeLessThanOrEqual(700)
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(390)
  }
  await inside()
  for (const [name, path] of [['Search', '/search'], ['Watchlist', '/series'], ['Files', '/files'], ['Settings', '/settings'], ['Downloads', '/']] as const) {
    const tab = tabs.getByRole('link', { name: new RegExp(`^${name}(?:\\s*\\d+)?$`) })
    await inside()
    // Click the current on-screen position: locator.click could scroll a broken bar back into view.
    const box = (await tab.boundingBox())!
    expect(box.height).toBeGreaterThanOrEqual(48)
    expect(box.y + box.height).toBeLessThanOrEqual(700)
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    await expect(page).toHaveURL(url => url.pathname === path)
    await expect(tabs.locator('[aria-current="page"]')).toHaveCount(1)
    await expect(tab).toHaveAttribute('aria-current', 'page')
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  }
})

test('Downloads has visible tab stops and no invisible click targets on a phone', async ({ page }) => {
  await serveDevice(page)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Downloads', exact: true })).toBeVisible()
  await expectVisibleTabStops(page)
  await expectNoInvisibleClickTargets(page)
})

test('at 320px the frame fits a long computer name in light and dark', async ({ page }) => {
  const name = 'A very long computer name with 日本語 and Polish ąęłó'.repeat(4)
  await serveDevice(page, { name })
  await page.setViewportSize({ width: 320, height: 700 })
  await page.goto('/settings')
  for (const mode of ['Dark', 'Light']) {
    await page.getByRole('radio', { name: mode, exact: true }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', `magnetar-${mode.toLowerCase()}`)
    await expect(page.locator('.shell-device')).toContainText(name)
    const computer = page.getByRole('button', { name: /Switch device/ })
    await computer.click()
    const menu = page.getByRole('menu')
    const box = (await menu.boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(320)
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
    await expect(computer).toBeFocused()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320)
  }
})

for (const language of ['en', 'de', 'pl', 'ru']) {
  test(`at 320px the ${language} tab labels remain readable`, async ({ page }) => {
    await serveDevice(page, { language })
    await page.setViewportSize({ width: 320, height: 700 })
    await page.goto('/')
    await expect(page.locator('html')).toHaveAttribute('lang', language)
    await page.evaluate(() => document.fonts.ready)
    const labels = page.locator('.shell-tab > span:first-child')
    await expect(labels).toHaveCount(5)
    for (const label of await labels.all()) {
      expect(await label.evaluate(node => node.scrollWidth <= node.clientWidth), 'the full label fits its tab').toBe(true)
      // A label on two lines breaks between words or at a hyphen the browser adds, never inside a syllable.
      const lines = await label.evaluate(node => {
        const range = document.createRange(), text = node.firstChild!, tops = new Map<number, string>()
        for (let i = 0; i < text.textContent!.length; i++) {
          range.setStart(text, i); range.setEnd(text, i + 1)
          const top = Math.round(range.getBoundingClientRect().top)
          tops.set(top, (tops.get(top) ?? '') + text.textContent![i])
        }
        return [...tops.values()]
      })
      if (language === 'en') expect(lines, 'English labels stay on one line').toHaveLength(1)
      for (const line of lines.slice(0, -1)) expect(line.length, `"${lines.join('|')}" leaves no lone letters`).toBeGreaterThanOrEqual(2)
      for (const line of lines.slice(1)) expect(line.length, `"${lines.join('|')}" leaves no lone letters`).toBeGreaterThanOrEqual(2)
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320)
  })
}
