import { expect, test, type Page } from '@playwright/test'
import { serveDevice } from '../fixtures/device.ts'

/** What the lanes canvas shows now, to compare two moments. */
const lanes = (page: Page) => page.locator('canvas.lanes-sky')
const picture = (page: Page) => lanes(page).evaluate(canvas => (canvas as HTMLCanvasElement).toDataURL())

/** Counts animation frames the page asks for, from before any script of the app runs. */
async function countFrames(page: Page) {
  await page.addInitScript(() => {
    const original = window.requestAnimationFrame.bind(window)
    ;(window as unknown as { frames: number }).frames = 0
    window.requestAnimationFrame = callback => { (window as unknown as { frames: number }).frames++; return original(callback) }
  })
  return () => page.evaluate(() => (window as unknown as { frames: number }).frames)
}

test('with reduced motion the downloads picture is one still frame; with motion it moves', async ({ page }) => {
  await serveDevice(page, { design: 'downloads' })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  await expect(page.locator('.download-row')).not.toHaveCount(0)
  const first = await picture(page)
  await page.waitForTimeout(1200)
  expect(await picture(page)).toBe(first)

  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.reload()
  await expect(page.locator('.download-row')).not.toHaveCount(0)
  const moving = await picture(page)
  await page.waitForTimeout(600)
  expect(await picture(page)).not.toBe(moving)
})

test('leaving Downloads leaves no animation loop behind', async ({ page }) => {
  const frames = await countFrames(page)
  await serveDevice(page, { design: 'downloads' })
  await page.goto('/')
  await expect(page.locator('.download-row')).not.toHaveCount(0)
  await page.waitForTimeout(300)
  expect(await frames()).toBeGreaterThan(5)
  await page.getByRole('link', { name: 'Settings', exact: true }).click()
  await expect(page.locator('canvas.sky')).toHaveCount(0)
  await page.waitForTimeout(100)
  const after = await frames()
  await page.waitForTimeout(1000)
  expect(await frames() - after).toBeLessThanOrEqual(1)
})

test('once this visit judged the computer slow, every picture is still, and stays still after a reload', async ({ page }) => {
  // How fast that judgement comes (36 frames and 1.2 s, medians over 28 ms or 9 ms) is @codefusion-cc/scene's own,
  // tested there on a deterministic clock. Here: Magnetar's pictures share its marker and honour it, without timing.
  await page.addInitScript(() => sessionStorage.setItem('codefusion-scene-slow', '1'))
  await serveDevice(page, { design: 'many' })
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.goto('/?view=all')
  await expect(page.locator('.download-row')).not.toHaveCount(0)
  const still = await picture(page)
  expect(still).not.toBe(await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 1; return c.toDataURL() }))
  await page.waitForTimeout(800)
  expect(await picture(page)).toBe(still)

  await page.reload()
  await expect(page.locator('.download-row')).not.toHaveCount(0)
  const afterReload = await picture(page)
  await page.waitForTimeout(800)
  expect(await picture(page)).toBe(afterReload)
})

test('on a 200-row list the canvas stays the height of the screen, and the lanes follow the rows when still', async ({ page }) => {
  const device = await serveDevice(page, { design: 'many' })
  const rows = device.downloads()
  const template = rows.find(d => d.status === 'Downloading')!
  for (let i = rows.length; i < 200; i++) rows.push({ ...template, id: 1000 + i, name: `Long list row ${i}`, progress: (i * 7) % 100 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/?view=all')
  await expect(page.locator('.download-row')).not.toHaveCount(0)
  // Windowed: the list is 200 rows long, a screenful of them in the page.
  await expect(page.locator('.download-row').first()).toHaveAttribute('aria-setsize', '200')
  expect(await page.locator('.download-row').count()).toBeLessThan(20)
  const viewport = page.viewportSize()!
  expect((await lanes(page).boundingBox())!.height).toBeLessThanOrEqual(viewport.height)

  await page.mouse.wheel(0, 2400)
  await page.waitForTimeout(300)
  expect((await lanes(page).boundingBox())!.height).toBeLessThanOrEqual(viewport.height)
  // A row brought into view by the scroll has its lane drawn where its bar is.
  const drawn = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('canvas.lanes-sky')!
    const box = canvas.getBoundingClientRect(), scale = canvas.width / box.width
    const row = [...document.querySelectorAll<HTMLElement>('.download-lane[data-status="Downloading"]')]
      .find(lane => { const r = lane.getBoundingClientRect(); return r.top > 120 && r.bottom < innerHeight - 40 })!
    const r = row.getBoundingClientRect(), y = Math.round((r.top + r.height / 2 - box.top) * scale)
    const pixels = canvas.getContext('2d')!.getImageData(Math.round((r.left - box.left + 2) * scale), y - 2, Math.round(20 * scale), 5).data
    let alpha = 0
    for (let i = 3; i < pixels.length; i += 4) alpha = Math.max(alpha, pixels[i]!)
    return alpha
  })
  expect(drawn).toBeGreaterThan(40)
})

for (const theme of ['dark', 'light'] as const) {
  test(`text over the pictures keeps AA contrast at three moments of the motion, ${theme}`, async ({ page }) => {
    await page.addInitScript(look => localStorage.setItem('magnetar-theme', look), theme)
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'no-preference' })
    for (const [design, route] of [['downloads', '/'], ['search', '/search/sintel']] as const) {
      await serveDevice(page, { design })
      await page.goto(route)
      await page.locator(design === 'search' ? '.source-figure li' : '.download-row').first().waitFor()
      for (const wait of [100, 1500, 6000]) {
        await page.waitForTimeout(wait === 100 ? wait : wait - 100)
        const worst = await page.evaluate(measureContrast, theme)
        expect.soft(worst, `${design} after ${wait} ms: ${JSON.stringify(worst)}`).toEqual(expect.objectContaining({ ok: true }))
      }
    }
  })
}

/**
 * The lowest contrast between text and what is behind it: the page with the canvas drawn over it. In light the canvas
 * shows through `invert(1) hue-rotate(180deg)`, applied here as the filter's colour matrices in sRGB.
 */
function measureContrast(theme: 'dark' | 'light') {
  // Computed colours may be oklch() or color(); the browser turns any of them into sRGB bytes on a 1-pixel canvas.
  const probe = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!
  const rgba = (css: string) => { probe.clearRect(0, 0, 1, 1); probe.fillStyle = '#000'; probe.fillStyle = css; probe.fillRect(0, 0, 1, 1); return [...probe.getImageData(0, 0, 1, 1).data] }
  const parse = (css: string) => rgba(css).slice(0, 3)
  const lum = ([r, g, b]: number[]) => [r, g, b].map(v => { const c = v! / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 })
    .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i]!, 0)
  const ratio = (a: number[], b: number[]) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x! + 0.05) / (y! + 0.05) }
  const filter = (rgb: number[]) => {
    if (theme === 'dark') return rgb
    const [r, g, b] = rgb.map(v => 1 - v! / 255)
    return [[-0.574, 1.43, 0.144], [0.426, 0.43, 0.144], [0.426, 1.43, -0.856]].map(row => Math.min(255, Math.max(0, (row[0]! * r! + row[1]! * g! + row[2]! * b!) * 255)))
  }
  const page = parse(getComputedStyle(document.body).backgroundColor)
  let worst = { ok: true, ratio: Infinity, text: '' }
  for (const canvas of document.querySelectorAll<HTMLCanvasElement>('canvas.sky')) {
    const box = canvas.getBoundingClientRect(), scale = canvas.width / box.width, ctx = canvas.getContext('2d')!
    const texts = [...document.querySelectorAll<HTMLElement>('h1, h2, p, span, b, button, a')]
      .filter(el => el.childElementCount === 0 && el.textContent!.trim() && !el.closest('[aria-hidden="true"]')
        && el.checkVisibility({ opacityProperty: true, visibilityProperty: true }))
    for (const el of texts) {
      const r = el.getBoundingClientRect()
      const left = Math.max(r.left, box.left), right = Math.min(r.right, box.right), top = Math.max(r.top, box.top), bottom = Math.min(r.bottom, box.bottom)
      if (right - left < 2 || bottom - top < 2) continue
      const style = getComputedStyle(el), color = parse(style.color)
      const size = parseFloat(style.fontSize), bold = Number(style.fontWeight) >= 700
      const needed = size >= 24 || (size >= 18.66 && bold) ? 3 : 4.5
      // Behind the text: its own background if it has one, else the page with the canvas over it.
      const own = parse(style.backgroundColor), opaque = rgba(style.backgroundColor)[3]! > 0
      for (let x = left + 1; x < right; x += 6) for (let y = top + 1; y < bottom; y += 4) {
        const [cr, cg, cb, ca] = ctx.getImageData(Math.round((x - box.left) * scale), Math.round((y - box.top) * scale), 1, 1).data
        const shown = filter([cr!, cg!, cb!]), a = ca! / 255
        const behind = opaque ? own : page.map((v, i) => shown[i]! * a + v! * (1 - a))
        const value = ratio(color, behind)
        if (value < needed && worst.ok) worst = { ok: false, ratio: Math.round(value * 100) / 100, text: el.textContent!.trim().slice(0, 40) }
        else if (worst.ok && value < worst.ratio) worst = { ok: true, ratio: Math.round(value * 100) / 100, text: el.textContent!.trim().slice(0, 40) }
      }
    }
  }
  return worst
}
