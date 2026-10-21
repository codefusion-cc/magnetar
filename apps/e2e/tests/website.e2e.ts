import { expect, test, type Page } from '@playwright/test'
import { expectVisibleTabStops } from '@codefusion-cc/testing/playwright'
import { LINK_CODE, serveWebsite } from '../fixtures/website.ts'

test.use({ timezoneId: 'Europe/Warsaw' })

/** The website's evening of 14 October 2026, so "yesterday, 23:10" is the night before. */
const evening = (page: Page) => page.clock.install({ time: new Date('2026-10-14T20:40:00+02:00') })

const row = (page: Page, name: string) => page.getByRole('listitem').filter({ has: page.getByRole('heading', { name, exact: true }) })

test('someone signed out lands on the first page, and Sign in takes them to sign in', async ({ page }) => {
  await serveWebsite(page, { signedIn: false })
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Search and download on your computer at home. Look in from anywhere.')
  await expect(page).toHaveURL(/\/$/)
  // The app for the system this browser runs on, and the line naming the two others.
  const get = page.getByRole('link', { name: /^Download for (macOS|Windows|Linux)$/ })
  await expect(get).toHaveAttribute('href', /^https:\/\/example\.org\/Magnetar-/)
  const system = (await get.innerText()).replace('Download for ', '')
  const others = ['macOS', 'Windows', 'Linux'].filter(name => name !== system)
  await expect(page.getByText(`Free. Also for ${others[0]} and ${others[1]}.`)).toBeVisible()
  await expect(page.getByRole('list', { name: 'The six sources it searches' }).getByRole('listitem')).toHaveText(['The Pirate Bay', '1337x', 'RARBG', 'Torrents-CSV', 'Nyaa', 'EZTV'])

  await page.getByRole('main').getByRole('link', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByRole('heading', { name: 'Sign in to Magnetar' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeEnabled()
  await expect(page.getByText('Google tells Magnetar your name, email address and profile picture, and nothing else.')).toBeVisible()
  // On the sign-in page the header doesn't offer it again.
  await expect(page.getByRole('banner').getByRole('link', { name: 'Sign in' })).toHaveCount(0)
})

test('someone signed in lands on their computers at /, not on the first page', async ({ page }) => {
  await serveWebsite(page)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Your computers', level: 1 })).toBeVisible()
  await expect(page.getByRole('heading', { name: /Search and download/ })).toHaveCount(0)
  await expect(page.getByRole('banner')).toContainText('alex@example.com')
})

test('after signing in, next goes only to a path on this site', async ({ page }) => {
  await serveWebsite(page)
  for (const next of ['//evil.example', 'https://evil.example/', '/\\evil.example', '/\tevil.example', 'javascript:alert(1)', 'evil.example']) {
    await page.goto(`/login?next=${encodeURIComponent(next)}`)
    await expect(page.getByRole('heading', { name: 'Your computers', level: 1 }), next).toBeVisible()
    expect(new URL(page.url()).pathname, next).toBe('/')
  }
  await page.goto(`/login?next=${encodeURIComponent('/about')}`)
  await expect(page).toHaveURL(/\/about$/)
})

test('a sign-in Google sends back with an error says so in a sentence, and keeps where to go next', async ({ page }) => {
  await serveWebsite(page, { signedIn: false })
  // This tab started the sign-in a moment ago, as startGoogleSignIn leaves it.
  await page.addInitScript(() => sessionStorage.setItem('codefusion-google-sign-in', JSON.stringify({ state: 'mine', nonce: 'n', createdAt: Date.now() })))
  await page.goto('/login?next=%2FMac-Mini-M1#google_state=mine&google_error=server_error')
  await expect(page.getByRole('alert')).toHaveText("Signing in with Google didn't work. Try again.")
  await expect(page).toHaveURL(/\/login\?next=%2FMac-Mini-M1$/)
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeEnabled()

  // A return this tab never started, or one too old, says that instead (a fresh load: a new fragment alone is no visit).
  await page.goto('/about')
  await page.goto('/login?next=%2FMac-Mini-M1#google_state=someone-else&google_error=server_error')
  await expect(page.getByRole('alert')).toHaveText('This sign-in took too long or started in another tab. Try again.')
  await expect(page).toHaveURL(/\/login\?next=%2FMac-Mini-M1$/)
})

test('a computer’s address still asks to sign in first and comes back to it', async ({ page }) => {
  await serveWebsite(page, { signedIn: false })
  await page.goto('/Mac-Mini-M1/search')
  await expect(page).toHaveURL(/\/login\?next=%2FMac-Mini-M1%2Fsearch$/)
  await expect(page.getByRole('heading', { name: 'Sign in to Magnetar' })).toBeVisible()
})

test('without scripts the first page still says what Magnetar is and where the app is', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL: test.info().project.use.baseURL })
  const page = await context.newPage()
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Magnetar', level: 1 })).toBeVisible()
  await expect(page.getByText(/Magnetar searches six torrent sources\s+at once/)).toBeVisible()
  await expect(page.getByRole('link', { name: 'github.com/codefusion-cc/magnetar/releases' })).toHaveAttribute('href', 'https://github.com/codefusion-cc/magnetar/releases/latest')
  await context.close()
})

for (const width of [320, 390, 1280]) {
  test(`the sources' names stay inside the picture at ${width} px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 })
    await serveWebsite(page, { signedIn: false })
    await page.goto('/')
    const figure = page.locator('.hero-sky')
    await expect(figure.getByRole('listitem')).toHaveCount(6)
    // Placed once the page has its size and the labels their typeface.
    await expect.poll(() => figure.getByRole('listitem').first().evaluate(li => li.style.transform)).toMatch(/^translate/)
    const outside = await figure.evaluate(element => {
      const box = element.getBoundingClientRect()
      return [...element.querySelectorAll('li')].map(li => ({ name: li.textContent, r: li.getBoundingClientRect() }))
        .filter(({ r }) => r.left < box.left - 0.5 || r.right > box.right + 0.5 || r.top < box.top - 0.5 || r.bottom > box.bottom + 0.5)
        .map(({ name }) => name)
    })
    expect(outside).toEqual([])
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0)
  })
}

test('each computer shows whether this browser can open it now, and how it is', async ({ page }) => {
  await evening(page)
  await serveWebsite(page)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Your computers', level: 1 })).toBeVisible()
  const expected = [
    ['Mac-Mini-M1', 'lit', 'Online. macOS, Magnetar 1.2.2.', 'Open'],
    ['MacBook-Pro', 'far', 'Online. This browser is not linked to it yet.', 'Link'],
    ['Living-Room-PC', 'out', 'Offline since yesterday, 23:10. Runs Magnetar 1.1.0, an update is waiting.', 'Open'],
  ] as const
  for (const [name, star, line, action] of expected) {
    const item = row(page, name)
    await expect(item.locator('.infall-star')).toHaveAttribute('data-state', star)
    await expect(item.getByText(line, { exact: true })).toBeVisible()
    await expect(item.getByRole('link', { name: `${action}: ${name}`, exact: true })).toHaveAttribute('href', `/${name}`)
  }
  await row(page, 'MacBook-Pro').getByRole('link', { name: 'Link: MacBook-Pro' }).click()
  await expect(page.getByRole('heading', { name: 'This browser is not linked to MacBook-Pro' })).toBeVisible()
})

test('signing out waits for the website, a second click is the same sign-out, and / becomes the first page', async ({ page }) => {
  const site = await serveWebsite(page)
  const views: { page: string; signedIn: boolean }[] = []
  page.on('request', request => {
    const body = request.method() === 'POST' ? request.postData() : null
    if (body?.includes('"type":"view"')) views.push(JSON.parse(body) as { page: string; signedIn: boolean })
  })
  await page.goto('/')
  await expect(row(page, 'Mac-Mini-M1')).toBeVisible()
  const signOut = page.getByRole('button', { name: 'Sign out' })
  await signOut.click()
  await expect(signOut).toBeDisabled()
  await signOut.click({ force: true })
  await expect(page.getByRole('heading', { name: /^Search and download/ })).toBeVisible()
  expect(site.logouts).toBe(1)
  await expect.poll(() => views.map(v => `${v.page}:${v.signedIn}`)).toEqual(['devices:true', 'home:false'])
})

test('a session that ended elsewhere shows the first page instead of a list going stale', async ({ page }) => {
  await page.clock.install()
  const site = await serveWebsite(page)
  await page.goto('/')
  await expect(row(page, 'Mac-Mini-M1')).toBeVisible()
  site.signOutElsewhere()
  site.failDevices(401)
  await page.clock.runFor(15_000)
  await expect(page.getByRole('heading', { name: /^Search and download/ })).toBeVisible()
})

test('a removed computer leaves the list at once, also when reading the list again fails', async ({ page }) => {
  const site = await serveWebsite(page)
  await page.goto('/')
  await row(page, 'Living-Room-PC').getByRole('button', { name: 'Remove: Living-Room-PC' }).click()
  site.failDevices(503)
  await page.locator('dialog[open]').getByRole('button', { name: 'Remove', exact: true }).click()
  await expect(row(page, 'Living-Room-PC')).toHaveCount(0)
  await expect(row(page, 'Mac-Mini-M1')).toBeVisible()
  expect(site.removed).toEqual(['pc'])
})

test('a magnet link sent here when the list cannot be read offers Try again, not linking again', async ({ page }) => {
  await serveWebsite(page, { devicesFail: 1, linked: ['mini', 'mbp'] })
  await page.goto('/add?uri=' + encodeURIComponent('magnet:?xt=urn:btih:08ada5a7a6183aae1e09d831df6748d566095a10&dn=Sintel'))
  const alert = page.getByRole('alert')
  await expect(alert.getByRole('heading', { name: 'Could not load your computers' })).toBeVisible()
  await expect(page.getByText('Link this browser to a computer first')).toHaveCount(0)
  await alert.getByRole('button', { name: 'Try again' }).click()
  await expect(page.getByRole('heading', { name: 'Download this on which computer?' })).toBeVisible()
  await expect(row(page, 'MacBook-Pro').getByText('Online. macOS, Magnetar 1.2.2.', { exact: true })).toBeVisible()
})

test('a list that could not be read says so instead of looking empty, and Try again reads it', async ({ page }) => {
  const site = await serveWebsite(page, { devicesFail: 1 })
  await page.goto('/')
  const alert = page.getByRole('alert')
  await expect(alert.getByRole('heading', { name: 'Could not load your computers' })).toBeVisible()
  await expect(alert).toContainText('The website did not answer. Your computers keep downloading.')
  await expect(page.getByText('No computer on this account yet')).toHaveCount(0)
  await alert.getByRole('button', { name: 'Try again' }).click()
  await expect(row(page, 'Mac-Mini-M1')).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
  expect(site.deviceReads).toBeGreaterThanOrEqual(2)
})

test('while the list is on its way the page says it is looking, and an account without computers says how to add one', async ({ page }) => {
  await serveWebsite(page, { holdDevices: true })
  await page.goto('/')
  await expect(page.getByRole('status').filter({ hasText: 'Looking for your computers' })).toBeVisible()
  await expect(page.getByRole('listitem')).toHaveCount(0)

  await page.unrouteAll({ behavior: 'ignoreErrors' })
  await serveWebsite(page, { devices: [] })
  await page.reload()
  await expect(page.getByRole('heading', { name: 'No computer on this account yet' })).toBeVisible()
  await expect(page.getByText('Open Magnetar on the computer and go to Settings, Remote access, Connect to your account.')).toBeVisible()
  await expect(page.getByRole('link', { name: /^Download for / })).toBeVisible()
})

test.describe('linking this browser by code', () => {
  test.beforeEach(async ({ page }) => {
    await serveWebsite(page)
    await page.goto('/MacBook-Pro')
    await expect(page.getByRole('heading', { name: 'This browser is not linked to MacBook-Pro' })).toBeVisible()
  })

  test('a code too short is refused before anything is sent, and the field keeps it', async ({ page }) => {
    const field = page.getByLabel('Code from the computer')
    await field.pressSequentially('7k2qm4xpd')
    await expect(field).toHaveValue('7K2QM-4XPD')
    await page.getByRole('button', { name: 'Link', exact: true }).click()
    await expect(page.getByRole('alert')).toHaveText('A code has 20 characters. This has 9.')
    await expect(field).toHaveValue('7K2QM-4XPD')
    await expect(field).toHaveAttribute('aria-invalid', 'true')
  })

  test('a code pasted in lower case with spaces links this browser', async ({ page }) => {
    const field = page.getByLabel('Code from the computer')
    await field.fill(` ${LINK_CODE.toLowerCase().replaceAll('-', ' ')} `)
    await page.getByRole('button', { name: 'Link', exact: true }).click()
    await expect(page.getByText('Linked to MacBook-Pro', { exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'This browser is not linked to MacBook-Pro' })).toHaveCount(0)
  })

  test('a code the computer does not know says so and stays to be corrected', async ({ page }) => {
    const field = page.getByLabel('Code from the computer')
    await field.fill('7K2QM-4XPDR-9TBVN-3HWJD')
    await page.getByRole('button', { name: 'Link', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('The device doesn’t accept this code.')
    await expect(field).toHaveValue('7K2QM-4XPDR-9TBVN-3HWJD')
    await expect(page.getByRole('heading', { name: 'This browser is not linked to MacBook-Pro' })).toBeVisible()
  })

  test('arriving puts focus on the page, so its heading is read out and no keyboard opens', async ({ page }) => {
    await expect(page.locator('section.not-linked')).toBeFocused()
  })

  test('the camera is a link away, and typing comes back with the keyboard in the field', async ({ page }) => {
    await page.getByRole('button', { name: 'Scan with the camera' }).click()
    await page.getByRole('button', { name: 'Type the code instead' }).click()
    await expect(page.getByLabel('Code from the computer')).toBeFocused()
    await expect(page.getByRole('link', { name: 'All computers' })).toHaveAttribute('href', '/')
  })
})

test('every website page can be used by keyboard', async ({ page }) => {
  await serveWebsite(page, { signedIn: false })
  for (const path of ['/', '/login']) {
    await page.goto(path)
    await page.locator('.site-main').waitFor()
    await expectVisibleTabStops(page)
  }
})

for (const language of ['en', 'pl', 'de', 'fr', 'es', 'it', 'pt', 'ru']) {
  test(`the website fits a phone in ${language}`, async ({ browser }) => {
    for (const signedIn of [false, true]) {
      const context = await browser.newContext({ viewport: { width: 390, height: 780 }, locale: language, baseURL: test.info().project.use.baseURL })
      const page = await context.newPage()
      await serveWebsite(page, { signedIn })
      for (const path of signedIn ? ['/', '/MacBook-Pro', '/about'] : ['/', '/login']) {
        await page.goto(path)
        await page.locator('.site-main h1').first().waitFor()
        const wide = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
        expect(wide, `${path} in ${language}`).toBeLessThanOrEqual(0)
      }
      await context.close()
    }
  })
}

for (const signedIn of [false, true]) {
  test(`${signedIn ? 'signed in' : 'signed out'}, the switch ends the website's top row and the footer no longer has one`, async ({ page }) => {
    await serveWebsite(page, { signedIn })
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.goto('/')
    const html = page.locator('html'), header = page.getByRole('banner')
    await expect(html).toHaveAttribute('data-theme', 'magnetar-dark')
    const controls = header.locator('a, button')
    await expect(controls.last()).toHaveAccessibleName('Switch to light mode')
    await expect(page.getByRole('contentinfo').getByText(/^Switch to/)).toHaveCount(0)
    await controls.last().click()
    await expect(html).toHaveAttribute('data-theme', 'magnetar-light')
    await expect(controls.last()).toHaveAccessibleName('Switch to dark mode')
  })
}
