import { expect, test as base, type Page } from '@playwright/test'
import { serveDevice } from '../fixtures/device.ts'
import { expectNoInvisibleClickTargets, expectVisibleTabStops } from '@codefusion-cc/testing/playwright'

const test = base.extend<{ device: Awaited<ReturnType<typeof serveDevice>> }>({
  device: [async ({ page }, use) => { await use(await serveDevice(page)) }, { auto: true }],
})

test('the desktop places are text links with exactly one current page', async ({ page }) => {
  await page.goto('/')
  const places = page.getByRole('navigation', { name: 'Menu', exact: true })
  await expect(places.getByRole('link')).toHaveCount(5)
  await expect(places.locator('svg')).toHaveCount(0)
  for (const [name, path] of [['Downloads', '/'], ['Search', '/search'], ['Watchlist', '/series'], ['Files', '/files'], ['Settings', '/settings']] as const) {
    const link = places.getByRole('link', { name: new RegExp(`^${name}(?:\\s*\\d+)?$`) })
    await link.click()
    await expect(page).toHaveURL(url => url.pathname === path)
    await expect(places.locator('[aria-current="page"]')).toHaveCount(1)
    await expect(link).toHaveAttribute('aria-current', 'page')
  }
})

test('Downloads has visible tab stops and no invisible click targets on desktop', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Downloads', exact: true })).toBeVisible()
  await page.keyboard.press('Tab')
  const firstTab = page.getByRole('navigation', { name: 'Menu', exact: true }).getByRole('link').first()
  await expect(firstTab).toBeFocused()
  await expect(firstTab).toHaveCSS('outline-style', 'solid')
  await expect(firstTab).toHaveCSS('outline-width', '2px')
  await expectVisibleTabStops(page)
  await expectNoInvisibleClickTargets(page)
})

test('the Downloads count follows active state changes and disappears after removal', async ({ page, device }) => {
  await page.goto('/')
  const places = page.getByRole('navigation', { name: 'Menu', exact: true })
  const downloads = places.getByRole('link', { name: /^Downloads/ })
  await expect(page.getByRole('contentinfo')).toHaveCount(0)
  const row = page.getByRole('listitem').filter({ hasText: 'Shell count' })
  await expect(downloads).toHaveText('Downloads')
  const link = `magnet:?xt=urn:btih:${'9'.repeat(40)}&dn=Shell%20count`
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  const add = page.getByRole('dialog', { name: 'Add magnet links or torrent files', exact: true })
  await add.getByRole('textbox').fill(link)
  await add.getByRole('button', { name: 'Download', exact: true }).click()
  await page.getByRole('button', { name: 'Download here', exact: true }).click()
  await expect(downloads).toHaveText(/^Downloads\s*1$/)
  const download = device.downloads()[0]!
  for (const [status, count] of [
    ['Paused', 0], ['Downloading', 1], ['Completed', 0], ['Seeding', 0], ['Error', 0], ['Queued', 1],
  ] as const) {
    device.send('downloads.updated', [{ ...download, status }])
    await expect(downloads).toHaveText(count ? /^Downloads\s*1$/ : 'Downloads')
  }
  await row.getByRole('button', { name: 'Remove', exact: true }).click()
  await page.getByRole('dialog', { name: 'Delete download', exact: true }).getByRole('button', { name: 'Keep files', exact: true }).click()
  await expect(row).toHaveCount(0)
  await expect(downloads).toHaveText('Downloads')
})

test('a connection opened during mount is shown as connected once the page has loaded', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Downloads', exact: true })).toBeVisible()
  await expect(page.getByRole('group', { name: 'Test computer', exact: true }).locator('[data-state]')).toHaveAttribute('data-state', 'lit')
  await expect(page.getByRole('group', { name: 'Test computer', exact: true })).toContainText('On this computer')
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('the star returns to lit after a dropped connection reconnects', async ({ page, device }) => {
  await page.clock.install()
  await page.goto('/')
  const star = page.getByRole('group', { name: 'Test computer', exact: true }).locator('[data-state]')
  await expect(star).toHaveAttribute('data-state', 'lit')
  device.disconnect()
  await expect(star).toHaveAttribute('data-state', 'far')
  await expect(page.getByRole('group', { name: 'Test computer', exact: true })).toContainText('Reconnecting')
  await page.clock.runFor(1500)
  await expect(star).toHaveAttribute('data-state', 'lit')
  await expect(page.getByRole('group', { name: 'Test computer', exact: true })).toContainText('On this computer')
})

test('the screen loader announces its words and honours reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.route('**/app-config.json', () => {})
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  const loading = page.getByRole('status').filter({ hasText: 'Loading…' })
  await expect(loading).toHaveText('Loading…')
  await expect(loading).toHaveAttribute('aria-live', 'polite')
  // The star is a canvas picture, hidden from screen readers; reduced motion is covered in sky.e2e.ts.
  await expect(loading.locator('canvas.state-sky[aria-hidden="true"]')).toBeVisible()
  const box = (await loading.boundingBox())!
  expect(box.height).toBeGreaterThanOrEqual(page.viewportSize()!.height)
})

test('the switch at the end of the top row flips light and dark, keeps the choice after a reload, and Settings can follow the system again', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('/')
  const html = page.locator('html'), header = page.getByRole('banner')
  await expect(html).toHaveAttribute('data-theme', 'magnetar-dark')
  const toLight = header.getByRole('button', { name: 'Switch to light mode', exact: true })
  const device = header.getByRole('group', { name: 'Test computer' })
  expect((await toLight.boundingBox())!.x).toBeGreaterThan((await device.boundingBox())!.x)

  await toLight.click()
  await expect(html).toHaveAttribute('data-theme', 'magnetar-light')
  const toDark = header.getByRole('button', { name: 'Switch to dark mode', exact: true })
  await expect(toDark).toBeFocused()
  await page.reload()
  await expect(html).toHaveAttribute('data-theme', 'magnetar-light')

  // Back to dark, which the system shows: the switch hands the page back to the system rather than holding it dark.
  await toDark.focus()
  await page.keyboard.press('Enter')
  await expect(html).toHaveAttribute('data-theme', 'magnetar-dark')
  await page.getByRole('navigation', { name: 'Menu', exact: true }).getByRole('link', { name: 'Settings' }).click()
  await expect(page.getByRole('radio', { name: 'System', exact: true })).toBeChecked()
  await page.emulateMedia({ colorScheme: 'light' })
  await expect(html).toHaveAttribute('data-theme', 'magnetar-light')
  await page.getByRole('radio', { name: 'Dark', exact: true }).click()
  await expect(html).toHaveAttribute('data-theme', 'magnetar-dark')
  await expect(header.getByRole('button', { name: 'Switch to light mode', exact: true })).toBeVisible()
})

/** Counts the view transitions the page starts: the theme's circle is one. */
const countTransitions = (page: Page) => page.addInitScript(() => {
  const start = document.startViewTransition.bind(document)
  Object.assign(window, { transitions: 0 })
  document.startViewTransition = (...args: Parameters<typeof start>) => {
    (window as unknown as { transitions: number }).transitions++
    return start(...args)
  }
})
const transitions = (page: Page) => page.evaluate(() => (window as unknown as { transitions: number }).transitions)

for (const motion of ['no-preference', 'reduce'] as const) {
  test(`a change of theme ${motion === 'reduce' ? 'is at once with reduced motion' : 'grows as a circle'}, from the switch and from Settings`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: motion })
    await countTransitions(page)
    await page.goto('/settings')
    const html = page.locator('html')
    await page.getByRole('banner').getByRole('button', { name: 'Switch to light mode', exact: true }).click()
    await expect(html).toHaveAttribute('data-theme', 'magnetar-light')
    await page.getByRole('radio', { name: 'Dark', exact: true }).click()
    await expect(html).toHaveAttribute('data-theme', 'magnetar-dark')
    expect(await transitions(page)).toBe(motion === 'reduce' ? 0 : 2)
  })
}
