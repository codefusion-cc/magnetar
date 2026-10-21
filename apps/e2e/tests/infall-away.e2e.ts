import { expect, test, type Locator, type Page } from '@playwright/test'
import type { UpdateStatusDto } from '@magnetar/protocol'
import { serveDevice } from '../fixtures/device.ts'

/** What the app says while 1.2.2 runs and 1.2.3 waits; `installing` once it took the update up. */
const status = (running = '1.2.2', available: string | null = '1.2.3', more: Partial<UpdateStatusDto> = {}): UpdateStatusDto => ({
  currentVersion: running, currentCommit: 'abcdef1', canSelfInstall: true, checking: false, installing: false,
  available: available ? { version: available, tag: `v${available}`, name: available, releaseUrl: 'https://example.org/releases', publishedAt: null } : null,
  lastCheckedAt: null, lastCheckError: null, lastCheckProblem: null, retryAt: null, ...more,
})

/** A computer on the account, through the relay, running `running` with `available` ready for it. */
async function computer(page: Page, { running = '1.2.2', available = '1.2.3' as string | null, name = undefined as string | undefined, language = 'en', remote = true } = {}) {
  const device = await serveDevice(page, name ? { name, language, remote } : { design: 'downloads', language, remote })
  device.setReply('updates.status', status(running, available))
  device.setReply('app.info', { version: running, commit: 'abcdef1', platform: 'macos', arch: 'arm64', dataDirectory: '/data', nativeFolderPicker: false, fileBrowser: true })
  /** The app comes back from its restart on `version`. */
  const back = (version: string, more: Partial<UpdateStatusDto> = {}) => {
    device.setReply('updates.status', status(version, version === '1.2.3' ? null : '1.2.3', more))
    device.setReply('app.info', { version, commit: 'abcdef1', platform: 'macos', arch: 'arm64', dataDirectory: '/data', nativeFolderPicker: false, fileBrowser: true })
    device.setOnline(true)
  }
  /** Update now, answered the way the app does: it says it installs, answers, then leaves to restart. */
  const install = async (button = 'Update now') => {
    const answer = device.holdNext('updates.install')
    device.setReply('updates.install', status(running, available, { installing: true }))
    await page.getByRole('button', { name: button, exact: true }).click()
    await expect.poll(() => device.calls.filter(c => c === 'updates.install').length).toBeGreaterThan(0)
    device.send('updates.changed', status(running, available, { installing: true }))
    answer()
  }
  return { device, back, install }
}

const bar = (page: Page, action: RegExp | string = /^(Update now|Try again)$/) => page.getByRole('main').getByRole('status').filter({ has: page.getByRole('button', { name: action }) })
const star = (page: Page, name = 'Mac-Mini-M1') => page.getByRole('group', { name, exact: true }).locator('[data-state]')
const downloadsHeading = (page: Page) => page.getByRole('heading', { level: 1, name: 'Downloads', exact: true })

test('the bar shows only while a newer version is ready, over the page title, and Later hides that version across a reload', async ({ page }) => {
  const { device } = await computer(page, { available: null })
  await page.goto('/Mac-Mini-M1')
  await expect(downloadsHeading(page)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Update now' })).toHaveCount(0)

  // The same version as running is not an update either.
  device.send('updates.changed', status('1.2.2', '1.2.2'))
  await expect(page.getByRole('button', { name: 'Update now' })).toHaveCount(0)

  device.setReply('updates.status', status())
  device.send('updates.changed', status())
  await expect(bar(page)).toHaveText(/^Magnetar 1\.2\.3 is ready for Mac-Mini-M1\. It runs 1\.2\.2 now\./)
  await expect(bar(page).getByRole('link', { name: 'What\'s new', exact: true })).toHaveAttribute('href', '/Mac-Mini-M1/settings/about')
  const [barBox, titleBox] = await Promise.all([bar(page).boundingBox(), downloadsHeading(page).boundingBox()])
  expect(barBox!.y + barBox!.height).toBeLessThan(titleBox!.y)

  await bar(page).getByRole('button', { name: 'Later', exact: true }).click()
  await expect(bar(page)).toHaveCount(0)
  const asked = device.calls.filter(c => c === 'updates.status').length
  await page.reload()
  await expect(downloadsHeading(page)).toBeVisible()
  // The reloaded page has heard of 1.2.3 again before it may say it keeps the bar hidden.
  await expect.poll(() => device.calls.filter(c => c === 'updates.status').length).toBeGreaterThan(asked)
  await page.waitForTimeout(300)
  await expect(page.getByRole('button', { name: 'Update now' })).toHaveCount(0)

  // Later was for 1.2.3 only: the next version is offered again.
  device.send('updates.changed', status('1.2.2', '1.2.4'))
  await expect(bar(page)).toContainText('Magnetar 1.2.4 is ready for Mac-Mini-M1.')
})

test('Update now gives the page to the Updating screen, which comes back by itself on the new version', async ({ page }) => {
  const { device, back, install } = await computer(page)
  await page.goto('/Mac-Mini-M1')
  await expect(bar(page)).toBeVisible()
  await install()

  const screen = page.getByRole('status').filter({ has: page.getByRole('heading', { level: 1, name: 'Updating Magnetar on Mac-Mini-M1', exact: true }) })
  await expect(screen).toContainText('The app restarts and this page comes back by itself. Downloads stop for a moment and carry on from where they were.')
  await expect(screen).toContainText('This usually takes less than a minute.')
  await expect(screen).toBeFocused()
  await expect(downloadsHeading(page)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Update now' })).toHaveCount(0)

  device.setOnline(false)
  await expect(star(page)).toHaveAttribute('data-state', 'out')
  await expect(page.getByRole('group', { name: 'Mac-Mini-M1', exact: true })).toContainText('Not reachable')
  // An update's restart is not the computer being offline.
  await page.waitForTimeout(600)
  await expect(screen).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Mac-Mini-M1 is offline' })).toHaveCount(0)
  await expect(page.getByRole('alert')).toHaveCount(0)

  back('1.2.3')
  await expect(downloadsHeading(page)).toBeVisible()
  await expect(screen).toHaveCount(0)
  await expect(page.getByText('Magnetar 1.2.3 is installed.')).toBeVisible()
  await expect(bar(page)).toHaveCount(0)
  await expect(star(page)).toHaveAttribute('data-state', 'lit')
  // Focus is back on the page, not lost to the document.
  await expect(page.getByRole('main')).toBeFocused()
})

test('an update the app did not install says so on the bar, and Try again installs again', async ({ page }) => {
  const { device, back, install } = await computer(page)
  await page.goto('/Mac-Mini-M1')
  await install()
  await expect(page.getByRole('heading', { name: 'Updating Magnetar on Mac-Mini-M1' })).toBeVisible()
  device.setOnline(false)
  await expect(star(page)).toHaveAttribute('data-state', 'out')
  back('1.2.2')

  await expect(bar(page)).toHaveText(/^The update was not installed\. Magnetar 1\.2\.2 is still running\./)
  await expect(downloadsHeading(page)).toBeVisible()
  await expect(bar(page).getByRole('link', { name: 'What\'s new' })).toHaveCount(0)
  await expect(bar(page).getByRole('button', { name: 'Close', exact: true })).toBeVisible()

  // Held, as the app takes its time to download the update.
  device.holdNext('updates.install')
  await bar(page).getByRole('button', { name: 'Try again', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Updating Magnetar on Mac-Mini-M1' })).toBeVisible()
  expect(device.calls.filter(c => c === 'updates.install')).toHaveLength(2)
})

test('an offline computer gets its own screen, without the bar, and the page reconnects by itself', async ({ page }) => {
  const { device } = await computer(page)
  await page.goto('/Mac-Mini-M1')
  await expect(bar(page)).toBeVisible()

  device.setOnline(false)
  const screen = page.getByRole('alert').filter({ has: page.getByRole('heading', { level: 1, name: 'Mac-Mini-M1 is offline', exact: true }) })
  await expect(screen).toContainText('It may be asleep or without internet. This page reconnects by itself when it is back.')
  await expect(screen.getByRole('link', { name: 'Other computers', exact: true })).toHaveAttribute('href', '/')
  await expect(bar(page)).toHaveCount(0)
  await expect(downloadsHeading(page)).toHaveCount(0)
  // What the page last heard of the computer's downloads is not shown as if it were now.
  await expect(page.getByRole('navigation').getByRole('link', { name: /^Downloads/ })).toHaveText('Downloads')
  await expect(page.getByRole('group', { name: 'Mac-Mini-M1', exact: true })).toContainText('Not reachable')
  // Unreachable: the star is only its ring.
  await expect(star(page)).toHaveAttribute('data-state', 'out')
  await expect(star(page)).toHaveCSS('box-shadow', /^[a-z]+\([^)]*\) 0px 0px 0px 1\.5px$/)
  // Only one message says so.
  await expect(page.getByText('It may be asleep or without internet.', { exact: false })).toHaveCount(1)

  device.setOnline(true)
  await expect(downloadsHeading(page)).toBeVisible()
  await expect(screen).toHaveCount(0)
  await expect(bar(page)).toBeVisible()
  await expect(page.getByRole('navigation').getByRole('link', { name: /^Downloads/ })).toHaveText('Downloads3')
  await expect(star(page)).toHaveAttribute('data-state', 'lit')
})

test('a short drop leaves the page as it is', async ({ page }) => {
  const { device } = await computer(page)
  await page.goto('/Mac-Mini-M1')
  await expect(downloadsHeading(page)).toBeVisible()
  // Remembers whether the offline screen showed at any moment, however briefly.
  await page.evaluate(() => {
    const seen = window as unknown as { offlineSeen: boolean }
    seen.offlineSeen = false
    new MutationObserver(() => { if (document.querySelector('.away-screen')) seen.offlineSeen = true }).observe(document.body, { childList: true, subtree: true })
  })
  device.setOnline(false)
  await page.waitForTimeout(200)
  device.setOnline(true)
  await expect(star(page)).toHaveAttribute('data-state', 'lit')
  await page.waitForTimeout(600)
  expect(await page.evaluate(() => (window as unknown as { offlineSeen: boolean }).offlineSeen)).toBe(false)
  await expect(downloadsHeading(page)).toBeVisible()
})

test('Other computers opens the account’s computers', async ({ page }) => {
  const { device } = await computer(page)
  await page.goto('/Mac-Mini-M1')
  await expect(downloadsHeading(page)).toBeVisible()
  device.setOnline(false)
  await page.getByRole('link', { name: 'Other computers', exact: true }).click()
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Your computers', exact: true })).toBeVisible()
})

test('on this computer’s own dashboard the bar and the Updating screen speak of this computer', async ({ page }) => {
  const { install } = await computer(page, { remote: false })
  await page.goto('/')
  await expect(bar(page)).toHaveText(/^Magnetar 1\.2\.3 is ready\. This computer runs 1\.2\.2\./)
  await install()
  await expect(page.getByRole('heading', { level: 1, name: 'Updating Magnetar', exact: true })).toBeVisible()
})

/** As long as a computer's name may be (`device-names.json`, maxLength 40), with no hyphen to break at. */
const longName = 'WohnzimmerRechnerImObergeschossLinks1234'

/** Nothing on the page is wider than the window, and the given parts stay inside it. */
async function fits(page: Page, ...parts: Locator[]) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320)
  for (const part of parts) {
    const box = (await part.boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(320)
  }
}

test('a long computer name in Polish fits the bar and both screens at 320 px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 })
  const { device, install } = await computer(page, { name: longName, language: 'pl' })
  await page.goto(`/${longName}`)
  const updateNow = page.getByRole('button', { name: 'Aktualizuj teraz', exact: true })
  await expect(updateNow).toBeVisible()
  await fits(page, bar(page, 'Aktualizuj teraz'), updateNow, page.getByRole('button', { name: 'Później', exact: true }))

  device.setOnline(false)
  const offline = page.getByRole('heading', { level: 1, name: `${longName} jest offline` })
  await expect(offline).toBeVisible()
  await fits(page, offline, page.getByRole('link', { name: 'Inne komputery' }))

  device.setOnline(true)
  await expect(updateNow).toBeVisible()
  await updateNow.click({ trial: true })
  await install('Aktualizuj teraz')
  const updating = page.getByRole('heading', { level: 1, name: `Trwa aktualizacja Magnetara na ${longName}` })
  await expect(updating).toBeVisible()
  await fits(page, updating)
})

test('the bar and the screens follow light and dark', async ({ page }) => {
  const { device } = await computer(page)
  const colours = async () => ({
    page: await page.evaluate(() => getComputedStyle(document.body).backgroundColor),
    bar: await bar(page).evaluate(element => [getComputedStyle(element).backgroundColor, getComputedStyle(element).color]),
  })
  await page.emulateMedia({ colorScheme: 'light' })
  await page.goto('/Mac-Mini-M1')
  await expect(bar(page)).toBeVisible()
  const light = await colours()
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect.poll(async () => (await colours()).page).not.toBe(light.page)
  const dark = await colours()
  expect(dark.bar).not.toEqual(light.bar)
  // Text keeps its contrast with the bar in both: the ink is not the bar's own colour.
  for (const scheme of [light, dark]) expect(scheme.bar[1]).not.toBe(scheme.bar[0])

  device.setOnline(false)
  const heading = page.getByRole('heading', { level: 1, name: 'Mac-Mini-M1 is offline' })
  await expect(heading).toBeVisible()
  const darkInk = await heading.evaluate(element => getComputedStyle(element).color)
  await page.emulateMedia({ colorScheme: 'light' })
  await expect.poll(() => heading.evaluate(element => getComputedStyle(element).color)).not.toBe(darkInk)
})
