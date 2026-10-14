import { expect, test as base } from '@playwright/test'
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
  const firstTab = page.locator('.shell-tab').first()
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
  await expect(page.getByRole('contentinfo')).toContainText('Magnetar')
  const row = page.getByRole('listitem').filter({ hasText: 'Shell count' })
  await expect(downloads).toHaveText('Downloads')
  const link = `magnet:?xt=urn:btih:${'9'.repeat(40)}&dn=Shell%20count`
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  const add = page.locator('dialog[open]').filter({ hasText: 'Add magnet links or torrent files' })
  await add.getByRole('textbox').fill(link)
  await add.getByRole('button', { name: 'Download', exact: true }).click()
  await page.getByRole('button', { name: 'Download here', exact: true }).click()
  await expect(downloads).toHaveText(/^Downloads\s*1$/)
  const download = device.downloads()[0]!
  for (const [status, count] of [
    ['Paused', 0], ['Downloading', 1], ['Completed', 0], ['Seeding', 1], ['Error', 0], ['Queued', 1],
  ] as const) {
    device.send('downloads.updated', [{ ...download, status }])
    await expect(downloads).toHaveText(count ? /^Downloads\s*1$/ : 'Downloads')
  }
  await row.getByRole('button', { name: 'Delete', exact: true }).click()
  await page.locator('dialog[open]').filter({ hasText: 'Delete download' }).getByRole('button', { name: 'Keep files', exact: true }).click()
  await expect(row).toHaveCount(0)
  await expect(downloads).toHaveText('Downloads')
})

test('a connection opened during mount is shown as connected once the page has loaded', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Downloads', exact: true })).toBeVisible()
  await expect(page.locator('.shell-device .infall-star')).toHaveAttribute('data-state', 'lit')
  await expect(page.locator('.shell-device')).toContainText('On this computer')
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('the star returns to lit after a dropped connection reconnects', async ({ page, device }) => {
  await page.clock.install()
  await page.goto('/')
  const star = page.locator('.shell-device .infall-star')
  await expect(star).toHaveAttribute('data-state', 'lit')
  device.disconnect()
  await expect(star).toHaveAttribute('data-state', 'far')
  await expect(page.locator('.shell-device')).toContainText('Reconnecting')
  await page.clock.runFor(1500)
  await expect(star).toHaveAttribute('data-state', 'lit')
  await expect(page.locator('.shell-device')).toContainText('On this computer')
})

test('the screen loader announces its words and honours reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.route('**/app-config.json', () => {})
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  const loading = page.getByRole('status').filter({ hasText: 'Loading…' })
  await expect(loading).toHaveText('Loading…')
  await expect(loading).toHaveAttribute('aria-live', 'polite')
  const star = loading.locator('[aria-hidden="true"]')
  await expect(star).toHaveCSS('animation-duration', '2.4s')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(star).toHaveCSS('animation-name', 'none')
  const box = (await loading.boundingBox())!
  expect(box.height).toBeGreaterThanOrEqual(page.viewportSize()!.height)
})
