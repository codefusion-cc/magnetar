import { expect, test } from '@playwright/test'
import { serveDevice } from '../fixtures/device.ts'

test('Play on a finished row opens the download playing, once', async ({ page }) => {
  const device = await serveDevice(page, { design: 'downloads' })
  await page.goto('/')
  const row = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: 'Sintel (2010) 1080p BluRay', exact: true }) })
  // The page listens once it has shown the list.
  await expect(row).toContainText('Downloading')
  device.send('downloads.updated', [{ ...device.downloads()[0]!, status: 'Completed', progress: 100, downloadSpeed: 0, completedAt: new Date().toISOString() }])
  await row.getByRole('button', { name: 'Play', exact: true }).click()
  await expect(page).toHaveURL(/\/downloads\/1$/)
  const player = page.getByRole('dialog', { name: 'Sintel.2010.1080p.BluRay.mkv' })
  await expect(player).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(player).toHaveCount(0)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Files', level: 2 })).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('the name on a row opens the download without playing it', async ({ page }) => {
  const device = await serveDevice(page, { design: 'downloads' })
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Sintel (2010) 1080p BluRay', exact: true })).toBeVisible()
  device.send('downloads.updated', [{ ...device.downloads()[0]!, status: 'Completed', progress: 100, downloadSpeed: 0, completedAt: new Date().toISOString() }])
  await expect(page.getByRole('button', { name: 'Play', exact: true }).first()).toBeVisible()
  await page.getByRole('button', { name: 'Sintel (2010) 1080p BluRay', exact: true }).click()
  await expect(page).toHaveURL(/\/downloads\/1$/)
  await expect(page.getByRole('heading', { name: 'Files', level: 2 })).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('a folder with things in it can become the download folder from Files', async ({ page }) => {
  const device = await serveDevice(page, { design: 'files' })
  await page.goto('/files')
  await page.getByRole('button', { name: /^Dragnet/ }).click()
  await expect(page.getByRole('heading', { name: 'Dragnet', level: 2 })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Season 4' })).toBeVisible()
  await page.getByRole('button', { name: 'Use as download folder', exact: true }).click()
  await expect.poll(() => device.calls.filter(call => call === 'settings.update')).toHaveLength(1)
})

test('with one place, Back to Files from a folder it cannot read lists the places', async ({ page }) => {
  const device = await serveDevice(page)
  device.failNext('fs.browse', 'It may be unplugged.', 'not_found')
  await page.goto('/files')
  await expect(page.getByRole('alert')).toContainText('It may be unplugged.')
  await page.getByRole('button', { name: 'Back to Files', exact: true }).click()
  await expect(page.getByRole('list', { name: 'Folders you can browse' })).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('Settings opened while the computer reconnects asks it once it is back', async ({ page }) => {
  const device = await serveDevice(page)
  device.setReply('agent.status', { enabled: true, allowRemote: false, token: 'token', mcpUrl: 'http://127.0.0.1:47820/mcp', endpointFile: '/data/endpoint.json' })
  await page.clock.install()
  await page.goto('/')
  await expect(page.getByRole('group', { name: 'Test computer', exact: true })).toContainText('On this computer')
  device.disconnect()
  await expect(page.getByRole('group', { name: 'Test computer', exact: true })).toContainText('Reconnecting')
  await page.evaluate(() => { history.pushState(null, '', '/settings/agents'); dispatchEvent(new PopStateEvent('popstate')) })
  await expect(page.getByRole('main')).toContainText('Changes save by themselves.')
  await page.clock.runFor(1500)
  await expect(page.getByRole('group', { name: 'Test computer', exact: true })).toContainText('On this computer')
  await expect(page.getByRole('main')).toContainText('http://127.0.0.1:47820/mcp')
})
