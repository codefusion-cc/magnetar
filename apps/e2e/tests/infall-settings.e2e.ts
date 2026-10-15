import { expect, test } from '@playwright/test'
import { expectVisibleTabStops } from '@codefusion-cc/testing/playwright'
import { serveDevice } from '../fixtures/device.ts'

const NOT_ANSWERED = 'Could not save. Mac-Mini-M1 did not answer, so this is back where it was.'

test('a change the computer did not take goes back and says so under its setting, until it saves', async ({ page }) => {
  const device = await serveDevice(page, { design: 'set-general' })
  await page.goto('/settings')
  const reports = page.getByRole('checkbox', { name: 'Send anonymous error reports' })
  await expect(reports).toBeChecked()
  device.failNext('settings.update', 'The device did not answer in time', 'timeout')
  await reports.click()
  const section = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Error reports' }) })
  await expect(section.getByRole('alert')).toHaveText(NOT_ANSWERED)
  await expect(reports).toBeChecked()
  expect(device.settings().errorReportsEnabled).toBe(true)
  // Only this setting says it; another section stays quiet.
  await expect(page.getByRole('alert')).toHaveCount(1)

  await reports.click()
  await expect(reports).not.toBeChecked()
  await expect(section.getByRole('alert')).toHaveCount(0)
  expect(device.settings().errorReportsEnabled).toBe(false)
})

test('a reason the computer gave is said instead, and a text field goes back to what the computer has', async ({ page }) => {
  const device = await serveDevice(page, { design: 'set-notify' })
  await page.goto('/settings/notifications')
  const host = page.getByRole('textbox', { name: 'SMTP server' })
  device.failNext('settings.update', 'smtp host is not allowed', 'bad_request')
  await host.fill('smtp.elsewhere.net')
  await host.press('Enter')
  const email = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Email' }) })
  await expect(email.getByRole('alert')).toHaveText('Could not save: smtp host is not allowed. This is back where it was.')
  await expect(host).toHaveValue('smtp.example.com')
  expect(device.settings().smtpHost).toBe('smtp.example.com')
})

test('Start Magnetar at login that did not change says so where it is, and stays as it was', async ({ page }) => {
  const device = await serveDevice(page, { design: 'set-general' })
  await page.goto('/settings')
  const startup = page.getByRole('checkbox', { name: 'Start Magnetar at login' })
  await expect(startup).toBeChecked()
  device.failNext('startup.set', 'The device did not answer in time', 'timeout')
  await startup.click()
  const section = page.locator('section').filter({ has: page.getByRole('heading', { name: 'When the computer starts' }) })
  await expect(section.getByRole('alert')).toHaveText(NOT_ANSWERED)
  await expect(startup).toBeChecked()
})

test('two quick changes are both saved, the second building on the first', async ({ page }) => {
  const device = await serveDevice(page, { design: 'set-sources' })
  await page.goto('/settings/sources')
  const release = device.holdNext('settings.update')
  await page.getByRole('checkbox', { name: 'Nyaa' }).click()
  await page.getByRole('checkbox', { name: 'RARBG' }).click()
  // Both show as chosen while the first is still on its way.
  await expect(page.getByRole('checkbox', { name: 'Nyaa' })).not.toBeChecked()
  await expect(page.getByRole('checkbox', { name: 'RARBG' })).not.toBeChecked()
  release()
  await expect.poll(() => [...device.settings().disabledProviders].sort()).toEqual(['EZTV', 'Nyaa', 'RARBG'])
  await expect(page.getByRole('checkbox', { name: 'EZTV' })).not.toBeChecked()
  await expect(page.getByRole('checkbox', { name: 'The Pirate Bay' })).toBeChecked()
})

test('the last value chosen wins, even when the first save is answered last', async ({ page }) => {
  const device = await serveDevice(page, { design: 'set-general' })
  await page.goto('/settings')
  const reports = page.getByRole('checkbox', { name: 'Send anonymous error reports' })
  await expect(reports).toBeChecked()
  // The computer is slow to answer the first change; meanwhile the box is ticked back on.
  const release = device.holdNext('settings.update')
  await reports.click()
  await expect(reports).not.toBeChecked()
  await reports.click()
  await expect(reports).toBeChecked()
  release()
  await expect.poll(() => device.log.filter(c => c.method === 'settings.update').map(c => c.params.errorReportsEnabled)).toEqual([false, true])
  await expect.poll(() => device.settings().errorReportsEnabled).toBe(true)
  await expect(reports).toBeChecked()
})

test('a secret is never shown: the field stays empty, saves what is typed, and can be cleared', async ({ page }) => {
  const device = await serveDevice(page, { design: 'set-notify' })
  await page.goto('/settings/notifications')
  const token = page.getByLabel('Bot token', { exact: true })
  await expect(token).toHaveAttribute('type', 'password')
  await expect(token).toHaveValue('')
  await expect(token).toHaveAttribute('placeholder', 'Saved')
  await token.fill('123:secret')
  await token.press('Enter')
  await expect.poll(() => device.log.filter(c => c.method === 'settings.update').map(c => c.params.telegramBotToken)).toEqual(['123:secret'])
  await expect(token).toHaveValue('')
  await page.getByRole('button', { name: 'Clear: Bot token' }).click()
  await expect.poll(() => device.log.filter(c => c.method === 'settings.update').map(c => c.params.telegramBotToken)).toEqual(['123:secret', ''])
})

test('speeds are typed in MB/s, with a decimal comma in Polish, and a speed too low is refused', async ({ page }) => {
  const device = await serveDevice(page, { design: 'set-dl', language: 'pl' })
  await page.goto('/settings/downloads')
  const download = page.getByRole('textbox', { name: 'Pobieranie, MB/s' }).first()
  await download.fill('1,5')
  await download.press('Enter')
  await expect.poll(() => device.settings().downloadLimit).toBe(1_500_000)
  await download.fill('0,001')
  await download.press('Enter')
  await expect(page.getByText(/Co najmniej .* KB\/s/)).toBeVisible()
  expect(device.settings().downloadLimit).toBe(1_500_000)
  await download.fill('')
  await download.press('Enter')
  await expect.poll(() => device.settings().downloadLimit).toBe(0)
})

test('a late report from the computer never overwrites what is being typed', async ({ page }) => {
  const device = await serveDevice(page, { design: 'set-dl' })
  await page.goto('/settings/downloads')
  const upload = page.getByRole('textbox', { name: 'Upload, MB/s' }).first()
  await upload.click()
  await upload.fill('7')
  // The computer repeats what it had (an echo of an earlier change) while the field still has focus.
  device.send('settings.changed', { ...device.settings(), uploadLimit: 1_000_000 })
  await page.waitForTimeout(200)
  await expect(upload).toHaveValue('7')
  await upload.press('Enter')
  await expect.poll(() => device.settings().uploadLimit).toBe(7_000_000)
  // Out of the field, what the computer reports is shown again.
  device.send('settings.changed', { ...device.settings(), uploadLimit: 3_000_000 })
  await expect(upload).toHaveValue('3')
})

test('the slower schedule: its times show focus, its days toggle, and an overnight window says so', async ({ page }) => {
  const device = await serveDevice(page, { design: 'set-dl' })
  await page.goto('/settings/downloads')
  const from = page.getByLabel('From', { exact: true })
  // Reached by keyboard, as someone without a mouse gets there: Tab from the field before it.
  await page.getByLabel('Upload, MB/s', { exact: true }).last().focus()
  await page.keyboard.press('Tab')
  await expect(from).toBeFocused()
  const ring = await from.evaluate(el => { const s = getComputedStyle(el); return `${s.outlineStyle} ${s.outlineWidth}` })
  expect(ring).toBe('solid 2px')
  await page.getByRole('button', { name: 'Sat', exact: true }).click()
  await expect.poll(() => device.settings().altScheduleDays).toEqual([0, 1, 2, 3, 4, 5])
  await from.fill('23:30')
  await page.getByLabel('To', { exact: true }).fill('07:00')
  await expect(page.getByText('Runs overnight: from the evening of a chosen day into the next morning.')).toBeVisible()
  expect(device.settings().altScheduleFrom).toBe(23 * 60 + 30)
})

test('every section can be reached and used by keyboard', async ({ page }) => {
  await serveDevice(page, { design: 'set-dl' })
  await page.goto('/settings/downloads')
  await expect(page.getByRole('link', { name: 'Downloads', exact: true }).last()).toHaveAttribute('aria-current', 'page')
  await expectVisibleTabStops(page)
  await page.getByRole('link', { name: 'Notifications', exact: true }).last().focus()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/settings\/notifications$/)
})

for (const language of ['en', 'pl', 'de', 'fr', 'es', 'it', 'pt', 'ru']) {
  test(`every section fits a phone in ${language}, also in a wide font`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 780 })
    await serveDevice(page, { design: 'set-dl', language })
    for (const section of ['', '/downloads', '/notifications', '/sources', '/remote', '/agents', '/about']) {
      await page.goto(`/settings${section}`)
      await page.locator('.settings-panel .setting').first().waitFor()
      // Until the page's own fonts arrive (or where a phone blocks them) a wider one stands in: Linux has DejaVu Sans.
      for (const font of ['the look\'s own', 'a wide stand-in']) {
        if (font !== 'the look\'s own') await page.addStyleTag({ content: '* { font-family: Verdana, "DejaVu Sans", sans-serif !important }' })
        const wide = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
        expect(wide, `/settings${section} in ${language}, ${font} font`).toBeLessThanOrEqual(0)
      }
    }
  })
}
