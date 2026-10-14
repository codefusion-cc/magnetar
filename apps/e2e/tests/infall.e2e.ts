import { expect, test } from '@playwright/test'
import { serveDevice } from '../fixtures/device.ts'
import { infallFiles } from '../fixtures/infall.ts'
import { expectNoInvisibleClickTargets, expectVisibleTabStops } from '@codefusion-cc/testing/playwright'

test('pause and resume double clicks each send one call, and failed calls can be retried', async ({ page }) => {
  const device = await serveDevice(page, { design: 'downloads', delay: 200 })
  await page.goto('/')
  const row = page.locator('[data-download-id="1"]')
  for (const [label, method, next] of [['Pause', 'downloads.pause', 'Resume'], ['Resume', 'downloads.resume', 'Pause']] as const) {
    await row.getByRole('button', { name: label, exact: true }).evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click() })
    await expect(row.getByRole('button', { name: next, exact: true })).toBeEnabled()
    expect(device.calls.filter(call => call === method)).toHaveLength(1)
  }
  device.failNext('downloads.pause', 'Network disconnected')
  await row.getByRole('button', { name: 'Pause', exact: true }).click()
  await expect(page.getByText('Network disconnected', { exact: true })).toBeVisible()
  await expect(row.getByRole('button', { name: 'Pause', exact: true })).toBeEnabled()
  await row.getByRole('button', { name: 'Pause', exact: true }).click()
  await expect(row.getByRole('button', { name: 'Resume', exact: true })).toBeEnabled()
  expect(device.calls.filter(call => call === 'downloads.pause')).toHaveLength(3)
})

test('a row finishing in Active keeps its position and becomes finished until the view changes', async ({ page }) => {
  const device = await serveDevice(page, { design: 'downloads' })
  await page.goto('/')
  const row = page.locator('[data-download-id="1"]')
  await expect(row).toContainText('Downloading')
  const before = await row.boundingBox()
  device.send('downloads.updated', [{ ...device.downloads()[0]!, status: 'Completed', progress: 100, downloadSpeed: 0, completedAt: new Date().toISOString() }])
  await expect(row).toContainText('Finished')
  await expect(row.getByRole('button', { name: 'Play', exact: true })).toBeVisible()
  const after = await row.boundingBox()
  expect(after?.y).toBe(before?.y)
  await page.getByRole('button', { name: 'Finished', exact: true }).click()
  await page.getByRole('button', { name: 'Active', exact: true }).click()
  await expect(row).toHaveCount(0)
})

test('one per-second push renders only its changed row', async ({ page }) => {
  await page.addInitScript(() => {
    type Fiber = { flags: number; elementType?: { displayName?: string }; memoizedProps?: { download?: { id: number } }; child?: Fiber; sibling?: Fiber }
    const commits: number[][] = []
    Object.assign(window, { rowCommits: commits, __REACT_DEVTOOLS_GLOBAL_HOOK__: {
      supportsFiber: true, inject: () => 1, onCommitFiberUnmount: () => {},
      onCommitFiberRoot: (_id: number, root: { current: Fiber }) => {
        const rows: number[] = []
        const walk = (fiber?: Fiber) => {
          if (!fiber) return
          if (fiber.elementType?.displayName === 'DownloadRow' && (fiber.flags & 1) && fiber.memoizedProps?.download) rows.push(fiber.memoizedProps.download.id)
          walk(fiber.child); walk(fiber.sibling)
        }
        walk(root.current)
        if (rows.length) commits.push(rows)
      },
    } })
  })
  const device = await serveDevice(page, { design: 'downloads' })
  await page.goto('/')
  const row = page.locator('[data-download-id="1"]')
  await expect(row).toContainText('64%')
  const rendered = () => page.evaluate(() => (window as unknown as { rowCommits: number[][] }).rowCommits)
  expect((await rendered()).flat()).toContain(1)
  await page.evaluate(() => { (window as unknown as { rowCommits: number[][] }).rowCommits.length = 0 })
  device.send('downloads.updated', [{ ...device.downloads()[0]!, progress: 65 }])
  await expect(row).toContainText('65%')
  expect(await rendered()).toEqual([[1]])
})

test('a 120-character title wraps on a phone and text actions remain reachable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 })
  const device = await serveDevice(page, { design: 'downloads' })
  await page.goto('/')
  const title = 'Żółw'.repeat(30)
  device.send('downloads.updated', [{ ...device.downloads()[0]!, name: title }])
  await expect(page.getByRole('button', { name: title, exact: true })).toBeVisible()
  const row = page.locator('[data-download-id="1"]')
  await expect(row.getByRole('button', { name: 'Pause', exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390)
  await page.keyboard.press('Tab')
  await expectNoInvisibleClickTargets(page)
  await expectVisibleTabStops(page)
})

test('an edited checkbox survives a later file list and new files keep their server choice', async ({ page }) => {
  await page.clock.install()
  const device = await serveDevice(page, { design: 'details', delay: 100 })
  device.setFiles(infallFiles().slice(0, 2))
  await page.goto('/downloads/1')
  const english = page.getByRole('checkbox', { name: 'Download Sintel.en.srt', exact: true })
  await english.uncheck()
  device.setFiles(infallFiles())
  await page.clock.runFor(2300)
  await expect(page.getByRole('checkbox')).toHaveCount(5)
  await expect(english).not.toBeChecked()
  await expect(page.getByRole('checkbox', { name: 'Download Sintel.pl.srt', exact: true })).toBeChecked()
  const save = page.getByRole('button', { name: 'Download these', exact: true })
  await save.evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click() })
  await page.clock.runFor(250)
  await expect(save).toHaveCount(0)
  expect(device.calls.filter(call => call === 'downloads.selectFiles')).toHaveLength(1)
  await page.clock.runFor(2300)
  await expect(english).not.toBeChecked()
})

test('a torrent with no files waits for peers and shows the arriving file', async ({ page }) => {
  await page.clock.install()
  const device = await serveDevice(page, { design: 'details' })
  device.setFiles([])
  await page.goto('/downloads/1')
  await expect(page.getByText('The list arrives with the first peer.', { exact: true })).toBeVisible()
  await expect(page.getByRole('checkbox')).toHaveCount(0)
  device.setFiles(infallFiles().slice(0, 1))
  await page.clock.runFor(2200)
  await expect(page.getByRole('checkbox')).toHaveCount(1)
  await expect(page.getByRole('checkbox')).toBeChecked()
})

test('failed details explain no peers and search using the title, without a dialog', async ({ page }) => {
  await serveDevice(page, { design: 'details-fail' })
  await page.goto('/downloads/5')
  await expect(page.getByRole('heading', { name: 'Night of the Living Dead (1968)', exact: true })).toBeVisible()
  await expect(page.getByText('No peers after 3 minutes', { exact: true })).toBeVisible()
  await expect(page.locator('dialog[open]')).toHaveCount(0)
  const search = page.getByRole('link', { name: 'Search for it', exact: true })
  await expect(search).toHaveAttribute('href', '/search/Night%20of%20the%20Living%20Dead%20(1968)')
  await search.click()
  await expect(page.getByRole('textbox')).toHaveValue('Night of the Living Dead (1968)')
})

test('read failure retries the real list and held downloads name the missing network', async ({ page }) => {
  await serveDevice(page, { design: 'downloads-fail' })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Could not read the downloads', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Try again', exact: true }).click()
  await expect(page.locator('[data-download-id="1"]')).toBeVisible()
})

test('held downloads and slow schedule use quiet text actions', async ({ page }) => {
  const device = await serveDevice(page, { design: 'held' })
  await page.goto('/')
  await expect(page.getByRole('status')).toContainText('utun4 is not connected, so downloads are waiting.')
  await expect(page.locator('.downloads-summary')).toContainText('Mac-Mini-M1 downloads only through utun4.')
  await expect(page.getByRole('link', { name: 'Network settings', exact: true })).toHaveAttribute('href', '/settings/downloads')
  device.send('transfer.changed', { engine: 'running', message: null, networkInterface: null, altSpeedActive: true, downloadLimit: 0, uploadLimit: 0, freeBytes: 137.8e9, diskFull: null })
  await page.getByRole('button', { name: 'Full speed', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Slow down', exact: true })).toBeVisible()
  await expect(page.locator('main button svg')).toHaveCount(0)
})
