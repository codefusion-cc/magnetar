import { expect, test, type Page } from '@playwright/test'
import type { DownloadDto, DownloadFileDto, FolderEntryDto, SearchResultDto } from '@magnetar/protocol'
import { serveDevice } from '../fixtures/device.ts'

/**
 * Long lists keep only the rows on screen in the page (`WindowedList` of @codefusion-cc/ui): Downloads, Search,
 * Files and the files of one download, each with one row height per breakpoint.
 */

const OVERSCAN = 4

/** Downloads newest first in the order given: `Row 1` on top. */
const makeDownloads = (count: number, name = (i: number) => `Row ${i + 1}`): DownloadDto[] => Array.from({ length: count }, (_, i) => ({
  id: i + 1, name: name(i), status: 'Downloading', progress: (i * 7) % 100, totalBytes: 1e9, downloadSpeed: 1e6, uploadSpeed: 0, peers: 3,
  source: 'The Pirate Bay', savePath: '/downloads', addedAt: new Date(Date.UTC(2026, 9, 14) - i * 60_000).toISOString(), completedAt: null,
  error: null, seriesTaskId: null, uploadedBytes: 0, partialFiles: null,
}))

/** The rows in the page and what the window may hold: the rows that fit, a part row at each end, and the overscan. */
async function windowOf(page: Page, list: string) {
  return page.locator(list).evaluate(ul => {
    const height = parseFloat(getComputedStyle(ul).getPropertyValue('--row-height'))
    const rows = [...ul.querySelectorAll(':scope > li')]
    return {
      height, mounted: rows.length, positions: rows.map(li => Number(li.getAttribute('aria-posinset'))),
      sizes: [...new Set(rows.map(li => li.getAttribute('aria-setsize')))], listHeight: ul.getBoundingClientRect().height,
      fits: Math.ceil(innerHeight / height) + 1,
    }
  })
}

async function expectWindowed(page: Page, list: string, count: number) {
  const window = await windowOf(page, list)
  expect(window.sizes).toEqual([String(count)])
  expect(window.listHeight).toBeCloseTo(window.height * count, 0)
  expect(window.mounted).toBeLessThanOrEqual(Math.min(count, window.fits + 2 * OVERSCAN))
  return window
}

/** Scrolls the page and waits for the frame the list measures in. */
async function scrollPage(page: Page, y: number | 'end') {
  await page.evaluate(async to => {
    window.scrollTo({ top: to === 'end' ? document.documentElement.scrollHeight : to, behavior: 'instant' })
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  }, y)
}

test.describe('Downloads', () => {
  test('no downloads show the empty state and no list', async ({ page }) => {
    await serveDevice(page)
    await page.goto('/?view=all')
    await expect(page.getByRole('heading', { name: 'Nothing is downloading' })).toBeVisible()
    await expect(page.getByRole('list', { name: 'Downloads', exact: true })).toHaveCount(0)
  })

  test('one download is one row of one', async ({ page }) => {
    const device = await serveDevice(page)
    device.setDownloads(makeDownloads(1))
    await page.goto('/?view=all')
    const list = page.getByRole('list', { name: 'Downloads', exact: true })
    await expect(list.getByRole('listitem')).toHaveCount(1)
    await expect(list.getByRole('listitem')).toHaveAttribute('aria-posinset', '1')
    await expect(list.getByRole('listitem')).toHaveAttribute('aria-setsize', '1')
    await expect(list.getByRole('button', { name: 'Row 1' })).toBeVisible()
  })

  test('34 downloads mount only the rows on screen, and the last is reached by scrolling', async ({ page }) => {
    const device = await serveDevice(page, { design: 'many' })
    expect(device.downloads()).toHaveLength(34)
    await page.goto('/?view=all')
    const list = page.getByRole('list', { name: 'Downloads', exact: true })
    await expect(list.getByRole('button', { name: 'Sintel (2010) 1080p BluRay' })).toBeVisible()
    const top = await expectWindowed(page, '.download-list', 34)
    expect(top.mounted).toBeLessThan(34)
    expect(top.positions[0]).toBe(1)
    await expect(list.getByRole('button', { name: 'Pioneer One S01E06 1080p WEB' })).toHaveCount(0)

    await scrollPage(page, 'end')
    await expect(list.getByRole('button', { name: 'Pioneer One S01E06 1080p WEB' })).toBeInViewport()
    const end = await expectWindowed(page, '.download-list', 34)
    expect(end.positions.at(-1)).toBe(34)
    expect(end.positions).not.toContain(1)
  })

  test('2000 downloads keep the same handful of rows anywhere in the list, in their order', async ({ page }) => {
    const device = await serveDevice(page)
    device.setDownloads(makeDownloads(2000))
    await page.goto('/?view=all')
    const list = page.getByRole('list', { name: 'Downloads', exact: true })
    await expect(list.getByRole('button', { name: 'Row 1', exact: true })).toBeVisible()
    await expectWindowed(page, '.download-list', 2000)

    const height = (await windowOf(page, '.download-list')).height
    const listTop = await page.locator('.download-list').evaluate(ul => ul.getBoundingClientRect().top + scrollY)
    await scrollPage(page, listTop + 1000 * height + 10)
    await expect(list.getByRole('button', { name: 'Row 1001', exact: true })).toBeInViewport()
    const middle = await expectWindowed(page, '.download-list', 2000)
    expect(middle.positions[0]).toBe(1001 - OVERSCAN)
    expect(middle.positions).toEqual(Array.from({ length: middle.mounted }, (_, i) => middle.positions[0]! + i))

    await scrollPage(page, 'end')
    await expect(list.getByRole('button', { name: 'Row 2000', exact: true })).toBeInViewport()
    await expectWindowed(page, '.download-list', 2000)
  })

  test('a push of progress, and a new download above, leave the reader on the same row', async ({ page }) => {
    const device = await serveDevice(page)
    const rows = makeDownloads(2000)
    device.setDownloads(rows)
    await page.goto('/?view=all')
    await expect(page.getByRole('button', { name: 'Row 1', exact: true })).toBeVisible()
    const height = (await windowOf(page, '.download-list')).height
    const listTop = await page.locator('.download-list').evaluate(ul => ul.getBoundingClientRect().top + scrollY)
    await scrollPage(page, listTop + 600 * height + 30)
    const reader = page.getByRole('button', { name: 'Row 601', exact: true })
    const before = (await reader.boundingBox())!.y
    const scrolled = await page.evaluate(() => scrollY)

    // The once-a-second push changes every row on screen.
    device.send('downloads.updated', rows.slice(590, 620).map(d => ({ ...d, progress: 99, downloadSpeed: 5e6 })))
    await expect(page.getByRole('progressbar', { name: 'Row 601' })).toHaveAttribute('aria-valuenow', '99')
    expect((await reader.boundingBox())!.y).toBe(before)
    expect(await page.evaluate(() => scrollY)).toBe(scrolled)

    // A download added now sorts first, one row above everything the reader sees.
    const added = { ...rows[0]!, id: 5000, name: 'Just added', addedAt: '2026-10-15T00:00:00Z' }
    device.setDownloads([added, ...rows])
    device.send('downloads.changed', device.downloads())
    await expect.poll(() => page.evaluate(() => scrollY)).toBe(scrolled + height)
    expect((await reader.boundingBox())!.y).toBe(before)
    await expect(page.locator('.download-list > li').first()).not.toHaveAttribute('aria-posinset', '1')
  })

  test('keyboard focus stays on a row scrolled far out of view, and Tab carries on from it', async ({ page }) => {
    const device = await serveDevice(page)
    device.setDownloads(makeDownloads(500))
    await page.goto('/?view=all')
    await expect(page.getByRole('button', { name: 'Row 1', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Row 3', exact: true }).focus()
    await page.keyboard.press('Tab')
    await expect(page.locator('li[aria-posinset="3"]').getByRole('button', { name: 'Pause' })).toBeFocused()

    await scrollPage(page, 30_000)
    await expect(page.getByRole('button', { name: 'Row 3', exact: true })).not.toBeInViewport()
    const focused = await page.evaluate(() => document.activeElement?.closest('li')?.getAttribute('aria-posinset'))
    expect(focused).toBe('3')
    await expectWindowedWith(page, 3)
    await page.keyboard.press('Tab')
    await expect(page.locator('li[aria-posinset="3"]').getByRole('button', { name: 'Remove' })).toBeFocused()
    // From the last control of the last mounted row, Tab reaches the next row, mounted on the way.
    await scrollPage(page, 0)
    const last = Math.max(...(await windowOf(page, '.download-list')).positions)
    await page.locator(`li[aria-posinset="${last}"]`).getByRole('button', { name: 'Remove' }).focus()
    await page.keyboard.press('Tab')
    await expect(page.getByRole('button', { name: `Row ${last + 1}`, exact: true })).toBeFocused()
    await expect(page.getByRole('button', { name: `Row ${last + 1}`, exact: true })).toBeInViewport()
  })

  test('a 120-character title on a 390 px phone is one line that ends inside its row', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    const device = await serveDevice(page)
    const title = 'An extraordinarily long release title that keeps going well past what any phone row can hold, 2160p WEB-DL x265 FINAL PROPER'.slice(0, 120)
    expect(title).toHaveLength(120)
    device.setDownloads(makeDownloads(3, i => (i === 1 ? title : `Row ${i + 1}`)))
    await page.goto('/?view=all')
    const button = page.getByRole('button', { name: title })
    await expect(button).toBeVisible()
    const box = await button.evaluate(element => {
      const row = element.closest('li')!.getBoundingClientRect(), own = element.getBoundingClientRect()
      const lines = element.getClientRects().length
      const inside = [...element.closest('li')!.querySelectorAll('*')].every(child => {
        const r = child.getBoundingClientRect()
        return !r.height || (r.top >= row.top - 0.5 && r.bottom <= row.bottom + 0.5 && r.right <= row.right + 0.5)
      })
      return { lines, height: own.height, lineHeight: parseFloat(getComputedStyle(element).lineHeight), cut: element.scrollWidth > element.clientWidth, rowHeight: row.height, inside }
    })
    expect(box.lines).toBe(1)
    expect(box.height).toBeLessThan(box.lineHeight * 2)
    expect(box.cut).toBe(true)
    expect(box.rowHeight).toBe(168)
    expect(box.inside).toBe(true)
    // The next row starts where this one ends.
    const second = await page.locator('li[aria-posinset="2"]').boundingBox()
    const third = await page.locator('li[aria-posinset="3"]').boundingBox()
    expect(third!.y - second!.y).toBe(168)
  })
})

async function expectWindowedWith(page: Page, position: number) {
  const window = await windowOf(page, '.download-list')
  expect(window.positions).toContain(position)
  // The focused row is the only one outside the window.
  expect(window.mounted).toBeLessThanOrEqual(window.fits + 2 * OVERSCAN + 1)
}

test('the lanes picture draws only rows in the window and lines up with them after a scroll', async ({ page }) => {
  const device = await serveDevice(page)
  device.setDownloads(makeDownloads(2000))
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/?view=all')
  await expect(page.getByRole('button', { name: 'Row 1', exact: true })).toBeVisible()
  await scrollPage(page, 50_000)
  await page.waitForTimeout(200)
  const canvas = page.locator('canvas.lanes-sky')
  expect((await canvas.boundingBox())!.height).toBeLessThanOrEqual(page.viewportSize()!.height)
  const lane = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('canvas.lanes-sky')!
    const box = canvas.getBoundingClientRect(), scale = canvas.width / box.width, ctx = canvas.getContext('2d')!
    const lanes = [...document.querySelectorAll<HTMLElement>('.download-lane')].map(l => l.getBoundingClientRect()).filter(r => r.top > 150 && r.bottom < innerHeight - 60)
    // Drawn at a lane's middle, and not at the row's facts line 40 px below it.
    const alpha = (x: number, y: number) => { const d = ctx.getImageData(Math.round((x - box.left) * scale), Math.round((y - box.top) * scale) - 2, Math.round(20 * scale), 5).data; let a = 0; for (let i = 3; i < d.length; i += 4) a = Math.max(a, d[i]!); return a }
    const r = lanes[0]!
    return { on: alpha(r.left + 2, r.top + r.height / 2), off: alpha(r.left + 2, r.top + r.height / 2 + 40), lanes: lanes.length }
  })
  expect(lane.lanes).toBeGreaterThan(3)
  expect(lane.on).toBeGreaterThan(40)
  expect(lane.off).toBeLessThan(lane.on / 2)
})

test('2000 search results mount a window of rows, and one far down downloads itself', async ({ page }) => {
  const device = await serveDevice(page, { design: 'search-start', manualSearch: true })
  device.settings().askDownloadFolder = false
  await page.goto('/search/sintel')
  await expect.poll(() => device.calls.filter(c => c === 'search.start').length).toBe(1)
  const results: SearchResultDto[] = Array.from({ length: 2000 }, (_, i) => ({
    resultId: `r${i}`, title: `Result ${i + 1}`, sizeBytes: 1e9, seeders: 5000 - i, leechers: 0, source: 'The Pirate Bay', publishedAt: null, detailsUrl: null, infoHash: null,
  }))
  device.send('search.results', { searchId: 'search1', results })
  // The same batch again (a resent event) still lists each result once.
  device.send('search.results', { searchId: 'search1', results: results.slice(0, 10) })
  device.send('search.done', { searchId: 'search1', error: null })
  const list = page.getByRole('list', { name: 'Search', exact: true })
  await expect(list.getByRole('button', { name: 'Result 1', exact: true })).toBeVisible()
  await expectWindowed(page, '.search-results', 2000)
  await scrollPage(page, 'end')
  await expect(list.getByRole('button', { name: 'Result 2000', exact: true })).toBeInViewport()
  await expectWindowed(page, '.search-results', 2000)
  await list.getByRole('button', { name: 'Download: Result 2000' }).click()
  await expect.poll(() => device.log.find(c => c.method === 'downloads.start')?.params.resultId).toBe('r1999')
})

test('a 3000-file torrent lists its files a window at a time, and a file far down can be ticked', async ({ page }) => {
  const device = await serveDevice(page, { design: 'details' })
  const files: DownloadFileDto[] = Array.from({ length: 3000 }, (_, i) => ({ index: i, path: `Season ${Math.floor(i / 100) + 1}/Episode ${i + 1}.mkv`, size: 1e8, done: 0, selected: true, media: null }))
  device.setFiles(files)
  await page.goto('/downloads/1')
  const list = page.getByRole('list', { name: 'Files', exact: true })
  await expect(list.getByText('Season 1/Episode 1.mkv', { exact: true })).toBeVisible()
  await expectWindowed(page, '.download-files', 3000)
  await scrollPage(page, 'end')
  const last = list.getByRole('checkbox', { name: /Episode 3000\.mkv/ })
  await expect(last).toBeInViewport()
  await expectWindowed(page, '.download-files', 3000)
  await last.uncheck()
  await expect(page.getByText(/^2,?999 files, /)).toBeVisible()
  await page.getByRole('button', { name: 'Download these' }).click()
  await expect.poll(() => device.log.find(c => c.method === 'downloads.selectFiles')?.params.files.length).toBe(2999)
  expect(device.log.find(c => c.method === 'downloads.selectFiles')!.params.files).not.toContain(2999)
})

test.describe('Files', () => {
  const entries: FolderEntryDto[] = Array.from({ length: 5000 }, (_, i) => ({ name: `Item ${String(i + 1).padStart(4, '0')}.mkv`, kind: 'file', size: 1e6, modified: null, media: null, download: null }))

  test('a folder of 5000 items reads its pages as the end comes near, each page once', async ({ page }) => {
    const device = await serveDevice(page)
    device.setFolder('/downloads', entries, 200)
    await page.goto('/files')
    const list = page.getByRole('list', { name: /Contents of/ })
    await expect(list.getByText('Item 0001.mkv', { exact: true })).toBeVisible()
    await expect(page.getByText(/^5,?000 items$/).first()).toBeVisible()
    await expectWindowed(page, '.folder-entries', 200)
    const pages = () => device.log.filter(c => c.method === 'fs.browse').map(c => c.params.offset ?? 0)
    expect(pages()).toEqual([0])
    for (let shown = 200; shown < 5000; shown += 200) {
      await scrollPage(page, 'end')
      await expect(page.locator('.folder-entries > li').first()).toHaveAttribute('aria-setsize', String(shown + 200))
    }
    await scrollPage(page, 'end')
    await expect(list.getByText('Item 5000.mkv', { exact: true })).toBeInViewport()
    await expectWindowed(page, '.folder-entries', 5000)
    expect(pages()).toEqual(Array.from({ length: 25 }, (_, i) => (i === 0 ? 0 : i * 200)))
  })

  test('a page that fails is not asked for again until Retry', async ({ page }) => {
    const device = await serveDevice(page)
    device.setFolder('/downloads', entries.slice(0, 300), 100)
    device.failNext('fs.browse', 'The computer did not answer in time', 'timeout', params => params.offset === 100)
    await page.goto('/files')
    await expect(page.getByText('Item 0001.mkv', { exact: true })).toBeVisible()
    await scrollPage(page, 'end')
    const retry = page.getByRole('button', { name: 'Try again' })
    await expect(retry).toBeVisible()
    await page.waitForTimeout(500)
    await scrollPage(page, 'end')
    expect(device.log.filter(c => c.method === 'fs.browse').map(c => c.params.offset ?? 0)).toEqual([0, 100])
    await retry.click()
    await expect(page.locator('.folder-entries > li').first()).toHaveAttribute('aria-setsize', '200')
    await expect(retry).toHaveCount(0)
    // The reader stays where they were; the last page comes once its end is near again.
    await page.waitForTimeout(300)
    expect(device.log.filter(c => c.method === 'fs.browse').map(c => c.params.offset ?? 0)).toEqual([0, 100, 100])
    await scrollPage(page, 'end')
    await expect(page.locator('.folder-entries > li').first()).toHaveAttribute('aria-setsize', '300')
    await scrollPage(page, 'end')
    await expect(page.getByText('Item 0300.mkv', { exact: true })).toBeInViewport()
    expect(device.log.filter(c => c.method === 'fs.browse').map(c => c.params.offset ?? 0)).toEqual([0, 100, 100, 200])
  })
})

test('the folder chooser in a dialog reads the next page as its own box scrolls to the end', async ({ page }) => {
  const device = await serveDevice(page)
  device.setFolder('/downloads', Array.from({ length: 250 }, (_, i) => ({ name: `Folder ${String(i + 1).padStart(3, '0')}`, kind: 'folder', size: null, modified: null, media: null, download: null })), 100)
  await page.goto('/settings/downloads')
  await page.getByRole('button', { name: 'Change: Download folder' }).click()
  const chooser = page.locator('dialog[open]').filter({ hasText: 'Choose folder' })
  const list = chooser.getByRole('list', { name: /Contents of/ })
  await expect(list.getByRole('button', { name: 'Folder 001' })).toBeVisible()
  const pages = () => device.log.filter(c => c.method === 'fs.browse').map(c => c.params.offset ?? 0)
  expect(pages()).toEqual([0])
  await list.evaluate(box => box.scrollTo({ top: box.scrollHeight, behavior: 'instant' }))
  await expect(list.getByRole('button', { name: 'Folder 200' })).toBeAttached()
  await list.evaluate(box => box.scrollTo({ top: box.scrollHeight, behavior: 'instant' }))
  await expect(list.getByRole('button', { name: 'Folder 250' })).toBeAttached()
  expect(pages()).toEqual([0, 100, 200])
})
