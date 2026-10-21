import { expect, test } from '@playwright/test'
import { serveDevice } from '../fixtures/device.ts'
import { infallFiles } from '../fixtures/infall.ts'
import { encodeHandshake } from '@magnetar/protocol/e2e'
import { expectNoInvisibleClickTargets, expectVisibleTabStops } from '@codefusion-cc/testing/playwright'

test('pause and resume double clicks each send one call, and failed calls can be retried', async ({ page }) => {
  const device = await serveDevice(page, { design: 'downloads', delay: 200 })
  await page.goto('/')
  const row = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: 'Sintel (2010) 1080p BluRay', exact: true }) })
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
  const row = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: 'Sintel (2010) 1080p BluRay', exact: true }) })
  await expect(row).toContainText('Downloading')
  const before = await row.boundingBox()
  device.send('downloads.updated', [{ ...device.downloads()[0]!, status: 'Completed', progress: 100, downloadSpeed: 0, completedAt: new Date().toISOString() }])
  await expect(row).toContainText('Finished')
  await expect(row.getByRole('button', { name: 'Play', exact: true })).toBeVisible()
  const after = await row.boundingBox()
  expect(after?.y).toBe(before?.y)
  await page.getByRole('radio', { name: 'Finished', exact: true }).click()
  await page.getByRole('radio', { name: 'Active', exact: true }).click()
  await expect(row).toHaveCount(0)
})

test('one per-second push renders only its changed row', async ({ page }) => {
  await page.addInitScript(() => {
    type Fiber = { flags: number; elementType?: { $$typeof?: symbol }; memoizedProps?: { download?: { id: number }; onOpen?: unknown }; child?: Fiber; sibling?: Fiber }
    const commits: number[][] = []
    Object.assign(window, { rowCommits: commits, __REACT_DEVTOOLS_GLOBAL_HOOK__: {
      supportsFiber: true, inject: () => 1, onCommitFiberUnmount: () => {},
      onCommitFiberRoot: (_id: number, root: { current: Fiber }) => {
        const rows: number[] = []
        const walk = (fiber?: Fiber) => {
          if (!fiber) return
          if (fiber.elementType?.$$typeof === Symbol.for('react.memo') && (fiber.flags & 1) && fiber.memoizedProps?.download && fiber.memoizedProps.onOpen) rows.push(fiber.memoizedProps.download.id)
          walk(fiber.child); walk(fiber.sibling)
        }
        walk(root.current)
        if (rows.length) commits.push(rows)
      },
    } })
  })
  const device = await serveDevice(page, { design: 'downloads' })
  await page.goto('/')
  const row = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: 'Sintel (2010) 1080p BluRay', exact: true }) })
  await expect(row).toContainText('64%')
  const rendered = () => page.evaluate(() => (window as unknown as { rowCommits: number[][] }).rowCommits)
  expect((await rendered()).flat()).toContain(1)
  await page.evaluate(() => { (window as unknown as { rowCommits: number[][] }).rowCommits.length = 0 })
  device.send('downloads.updated', [{ ...device.downloads()[0]!, progress: 65 }])
  await expect(row).toContainText('65%')
  expect(await rendered()).toEqual([[1]])
})

test('a 120-character title stays one line on a phone and text actions remain reachable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 })
  const device = await serveDevice(page, { design: 'downloads' })
  await page.goto('/')
  await expect(page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: 'Sintel (2010) 1080p BluRay', exact: true }) })).toBeVisible()
  const title = 'Żółw'.repeat(30)
  device.send('downloads.updated', [{ ...device.downloads()[0]!, name: title }])
  await expect(page.getByRole('button', { name: title, exact: true })).toBeVisible()
  const row = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: title, exact: true }) })
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
  await english.evaluate(input => { (input as HTMLInputElement).click(); (input as HTMLInputElement).click() })
  await expect(english).toBeChecked()
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
  await expect(page.getByRole('dialog')).toHaveCount(0)
  const search = page.getByRole('link', { name: 'Search for it', exact: true })
  await expect(search).toHaveAttribute('href', '/search/Night%20of%20the%20Living%20Dead%20(1968)')
  await search.click()
  await expect(page.getByRole('searchbox')).toHaveValue('Night of the Living Dead (1968)')
})

test('read failure retries the real list and held downloads name the missing network', async ({ page }) => {
  await serveDevice(page, { design: 'downloads-fail' })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Could not read the downloads', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Try again', exact: true }).click()
  await expect(page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: 'Sintel (2010) 1080p BluRay', exact: true }) })).toBeVisible()
})

test('held downloads and slow schedule use quiet text actions', async ({ page }) => {
  const device = await serveDevice(page, { design: 'held' })
  await page.goto('/')
  await expect(page.getByRole('status').filter({ hasText: 'utun4 is not connected' })).toContainText('utun4 is not connected, so downloads are waiting.')
  await expect(page.getByRole('main')).toContainText('Mac-Mini-M1 downloads only through utun4.')
  await expect(page.getByRole('link', { name: 'Network settings', exact: true })).toHaveAttribute('href', '/settings/downloads')
  device.send('transfer.changed', { engine: 'running', message: null, networkInterface: null, altSpeedActive: true, downloadLimit: 0, uploadLimit: 0, freeBytes: 137.8e9, diskFull: null })
  device.send('settings.changed', { ...device.settings(), altSpeedMode: 'scheduled', altScheduleTo: 420 })
  await expect(page.getByRole('main')).toContainText('Slowed down until 07:00')
  await page.getByRole('button', { name: 'Full speed', exact: true }).evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click() })
  await expect(page.getByRole('button', { name: 'Slow down', exact: true })).toBeVisible()
  expect(device.calls.filter(call => call === 'settings.update')).toHaveLength(1)
  await expect(page.locator('main button svg')).toHaveCount(0)
})

test('failed file reads can be retried and a rejected selection keeps the edits', async ({ page }) => {
  const device = await serveDevice(page, { design: 'details' })
  device.downloads()[0]!.status = 'Paused'
  device.failNext('downloads.files', 'Could not read files')
  await page.goto('/downloads/1')
  await expect(page.getByText('Could not read files', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Try again', exact: true }).click()
  const chosen = page.getByRole('checkbox', { name: 'Download Sintel.de.srt', exact: true })
  await expect(chosen).toBeVisible()
  await chosen.check()
  device.failNext('downloads.selectFiles', 'Selection rejected')
  const save = page.getByRole('button', { name: 'Download these', exact: true })
  await save.click()
  await expect(page.getByText(/Selection rejected/)).toBeVisible()
  await expect(chosen).toBeChecked()
  await expect(save).toBeEnabled()
  await save.click()
  await expect(save).toHaveCount(0)
  await expect(chosen).toBeChecked()
})

test('loading the list does not block the computer frame or other settings', async ({ page }) => {
  await serveDevice(page, { design: 'loading' })
  await page.goto('/')
  await expect(page.getByRole('status').filter({ hasText: 'Connecting to Mac-Mini-M1' })).toHaveText('Connecting to Mac-Mini-M1')
  const skeleton = page.getByRole('main').getByRole('list', { includeHidden: true })
  await expect(skeleton).toHaveAttribute('aria-hidden', 'true')
  await expect(skeleton.getByRole('listitem', { includeHidden: true })).toHaveCount(4)
  await page.getByRole('link', { name: 'Settings', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible()
})

test('a phone row finishing keeps the next download at the same position', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 })
  const device = await serveDevice(page, { design: 'downloads' })
  await page.goto('/')
  const row = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: 'Sintel (2010) 1080p BluRay', exact: true }) })
  const next = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: 'ubuntu-26.04.1-desktop-amd64.iso', exact: true }) })
  await expect(row).toContainText('64%')
  const before = await next.boundingBox()
  device.send('downloads.updated', [{ ...device.downloads()[0]!, status: 'Completed', progress: 100, downloadSpeed: 0, completedAt: new Date().toISOString() }])
  await expect(row).toContainText('Finished')
  const after = await next.boundingBox()
  expect(after?.y).toBe(before?.y)
})

test('download views wrap with the arrow keys and Home and End select the boundary', async ({ page }) => {
  await serveDevice(page, { design: 'downloads' })
  await page.goto('/')
  const views = page.getByRole('radiogroup', { name: 'Show', exact: true })
  const active = views.getByRole('radio', { name: 'Active', exact: true })
  await active.focus()
  await page.keyboard.press('ArrowLeft')
  await expect(views.getByRole('radio', { name: 'All', exact: true })).toBeChecked()
  await expect(page).toHaveURL(/\?view=all$/)
  await page.keyboard.press('Home')
  await expect(active).toBeChecked()
  await page.keyboard.press('End')
  await expect(views.getByRole('radio', { name: 'All', exact: true })).toBeChecked()
  await page.keyboard.press('ArrowUp')
  await expect(views.getByRole('radio', { name: 'Finished', exact: true })).toBeChecked()
  await expect(views.getByRole('radio', { checked: true })).toHaveCount(1)
})

test('an initial list reply cannot overwrite a newer progress push', async ({ page }) => {
  const device = await serveDevice(page, { design: 'downloads', holdList: true })
  await page.goto('/')
  await expect(page.getByRole('status').filter({ hasText: 'Connecting to Mac-Mini-M1' })).toHaveText('Connecting to Mac-Mini-M1')
  device.send('downloads.updated', [{ ...device.downloads()[0]!, progress: 65 }])
  device.releaseList()
  await expect(page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: 'Sintel (2010) 1080p BluRay', exact: true }) })).toContainText('65%')
})

test('a download error with known files keeps them available and does not claim there are no peers', async ({ page }) => {
  const device = await serveDevice(page, { design: 'details' })
  Object.assign(device.downloads()[0]!, { status: 'Error', error: 'Permission denied writing to /Movies' })
  await page.goto('/downloads/1')
  await expect(page.getByText('Permission denied writing to /Movies', { exact: true })).toBeVisible()
  await expect(page.getByText('Nobody is sharing this torrent right now, so Magnetar stopped looking. Try again later or search for another release.', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('checkbox', { name: 'Download Sintel.en.srt', exact: true })).toBeChecked()
  await expect(page.getByText('The list arrives with the first peer.', { exact: true })).toHaveCount(0)
})

test('the last running download finishes without moving its row on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 })
  const device = await serveDevice(page, { design: 'downloads' })
  await page.goto('/')
  const download = device.downloads()[0]!
  const row = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: 'Sintel (2010) 1080p BluRay', exact: true }) })
  await expect(row).toContainText('64%')
  device.send('downloads.changed', [download])
  await expect(page.getByRole('main')).toContainText('downloading one thing')
  const before = await row.boundingBox()
  device.send('downloads.updated', [{ ...download, status: 'Completed', progress: 100, downloadSpeed: 0 }])
  await expect(row).toContainText('Finished')
  expect((await row.boundingBox())?.y).toBe(before?.y)
})

test('the remote frame and its computer menu use text controls without icons', async ({ page }) => {
  await serveDevice(page, { design: 'downloads', remote: true })
  await page.goto('/Mac-Mini-M1')
  const frame = page.getByRole('banner')
  await frame.getByRole('button', { name: /Switch device/ }).click()
  await expect(frame.getByRole('menuitem', { name: 'All computers', exact: true })).toBeVisible()
  // The mark and the theme switch are the frame's only pictures.
  await expect(frame.getByRole('group', { name: 'Mac-Mini-M1', exact: true }).locator('svg')).toHaveCount(0)
  await expect(frame.getByRole('menu').locator('svg')).toHaveCount(0)
})

test('initial remote loading uses one connection message and the unreachable star has only its ring', async ({ page }) => {
  await page.clock.install()
  await serveDevice(page, { design: 'loading', remote: true })
  await page.goto('/Mac-Mini-M1')
  await expect(page.getByRole('status').filter({ hasText: 'Connecting to Mac-Mini-M1' })).toHaveText('Connecting to Mac-Mini-M1')
  await page.clock.runFor(1000)
  await expect(page.getByRole('group', { name: 'Mac-Mini-M1', exact: true }).locator('[data-state]')).toHaveAttribute('data-state', 'out')
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(page.getByRole('group', { name: 'Mac-Mini-M1', exact: true }).locator('[data-state]')).toHaveCSS('box-shadow', /^[a-z]+\([^)]*\) 0px 0px 0px 1\.5px$/)
})


test('an unlinked browser still sees its rejection during the initial download read on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 })
  await page.clock.install()
  await serveDevice(page, { design: 'loading', remote: true })
  await page.routeWebSocket('**/api/devices/test/connect', socket => {
    socket.send(JSON.stringify({ t: 'device', online: true }))
    socket.onMessage(() => socket.send(Buffer.from(encodeHandshake({ t: 'reject', reason: 'unknown-key' }))))
  })
  await page.goto('/Mac-Mini-M1')
  await expect(page.getByRole('group', { name: 'Mac-Mini-M1', exact: true })).toContainText('This browser is no longer linked to the device.')
  await page.clock.runFor(1000)
  await expect(page.getByRole('alert')).toHaveText('This browser is no longer linked to the device.')
})

test('Try again after a failed read asks only for the lists, and pushes still arrive afterwards', async ({ page }) => {
  const device = await serveDevice(page, { design: 'downloads-fail' })
  await page.goto('/')
  await expect(page.getByRole('alert')).toBeVisible()
  const infoCalls = device.calls.filter(c => c === 'app.info').length
  await page.getByRole('button', { name: 'Try again' }).click()
  await expect(page.getByRole('list', { name: 'Downloads', exact: true }).getByRole('listitem')).not.toHaveCount(0)
  expect(device.calls.filter(c => c === 'app.info')).toHaveLength(infoCalls)
  expect(device.calls.filter(c => c === 'downloads.list')).toHaveLength(2)
  device.send('downloads.changed', [])
  await expect(page.getByRole('list', { name: 'Downloads', exact: true }).getByRole('listitem')).toHaveCount(0)
})
