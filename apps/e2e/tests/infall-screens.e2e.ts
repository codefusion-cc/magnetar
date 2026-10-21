import { expect, test } from '@playwright/test'
import { serveDevice } from '../fixtures/device.ts'
import { infallSearch, infallSeries } from '../fixtures/infall.ts'
import { expectNoInvisibleClickTargets, expectVisibleTabStops } from '@codefusion-cc/testing/playwright'

test.use({ timezoneId: 'Europe/Warsaw' })

test('Search double submit, out-of-order sources, a late failed source, then a cancelled answer', async ({ page }) => {
  const device = await serveDevice(page, { design: 'search-start', manualSearch: true })
  await page.goto('/search')
  await page.getByRole('searchbox').fill('sintel')
  await page.getByRole('form', { name: 'Search', exact: true }).evaluate(form => { (form as HTMLFormElement).requestSubmit(); (form as HTMLFormElement).requestSubmit() })
  await expect.poll(() => device.calls.filter(c => c === 'search.start').length).toBe(1)
  await page.getByRole('form', { name: 'Search', exact: true }).evaluate(form => { (form as HTMLFormElement).requestSubmit(); (form as HTMLFormElement).requestSubmit() })
  expect(device.calls.filter(c => c === 'search.start')).toHaveLength(1)
  const data = infallSearch('search')
  device.send('search.source', {searchId:'search1',outcome:data.outcomes[2]!})
  device.send('search.source', {searchId:'search1',outcome:data.outcomes[2]!})
  await expect(page.getByRole('status').filter({ hasText: 'results so far' })).toHaveText('8 results so far. Five sources are still answering.')
  device.send('search.results', {searchId:'search1',results:[data.results[0]!]})
  await expect(page.getByRole('list', { name: 'Search', exact: true }).getByRole('heading', { level: 2 })).toHaveText([data.results[0]!.title])
  device.send('search.source', {searchId:'search1',outcome:data.outcomes[0]!})
  device.send('search.source', {searchId:'search1',outcome:data.outcomes[5]!})
  await expect(page.getByRole('list').filter({ hasText: '1337x' })).toContainText('no answer')
  await expect(page.getByRole('list', { name: 'Search', exact: true }).getByRole('heading', { level: 2 })).toHaveCount(1)
  // Changing a filter cancels the old search and starts a fresh one.
  await page.getByRole('radio', {name:'720p',exact:true}).click()
  await expect.poll(() => device.calls.filter(c => c === 'search.start').length).toBe(2)
  device.send('search.results', {searchId:'search1',results:[{...data.results[1]!,title:'Late cancelled result'}]})
  device.send('search.done', {searchId:'search1',error:null})
  device.send('search.results', {searchId:'search2',results:[data.results[2]!]})
  await expect(page.getByRole('list', { name: 'Search', exact: true }).getByRole('heading', { level: 2 })).toHaveText([data.results[2]!.title])
  await expect(page.getByRole('button',{name:'Search',exact:true})).toBeDisabled()
  device.send('search.done', {searchId:'search2',error:null})
  await expect(page.getByRole('button',{name:'Search',exact:true})).toBeEnabled()
})

test('all sources returning zero differs from all sources failing; retry and download double click', async ({ page }) => {
  const device = await serveDevice(page, { design:'search-start', manualSearch:true, delay:200 })
  await page.goto('/search/sintel')
  await expect.poll(() => device.calls.includes('search.start')).toBe(true)
  const data = infallSearch('search')
  for (const outcome of data.outcomes) device.send('search.source', {searchId:'search1',outcome:{...outcome,status:'ok',returned:0}})
  device.send('search.done', {searchId:'search1',error:null})
  await expect(page.getByRole('status').filter({ hasText: 'Nothing found' })).toContainText('Nothing found for “sintel”.')
  await expect(page.getByText('Check the spelling, or try fewer words.')).toBeVisible()
  await page.getByRole('button',{name:'Search',exact:true}).click()
  await expect.poll(() => device.calls.filter(c => c==='search.start').length).toBe(2)
  for (const outcome of data.outcomes) device.send('search.source', {searchId:'search2',outcome:{...outcome,status:'failed',returned:0}})
  device.send('search.done', {searchId:'search2',error:null})
  await expect(page.getByRole('alert')).toHaveText('No source answered.')
  await page.getByRole('button',{name:'Try again',exact:true}).click()
  await expect.poll(() => device.calls.filter(c => c==='search.start').length).toBe(3)
  device.send('search.results',{searchId:'search3',results:[data.results[0]!]})
  device.send('search.done',{searchId:'search3',error:null})
  await page.getByRole('button',{name:`Download: ${data.results[0]!.title}`,exact:true}).evaluate(b => { (b as HTMLButtonElement).click(); (b as HTMLButtonElement).click() })
  await expect(page.getByRole('dialog')).toHaveCount(1)
  const save = page.getByRole('button',{name:'Download here',exact:true})
  await expect(save).toBeEnabled()
  await save.evaluate(b => { (b as HTMLButtonElement).click(); (b as HTMLButtonElement).click() })
  await expect.poll(() => device.calls.filter(c=>c==='downloads.start').length).toBe(1)
  await expect(page.getByRole('button', { name: `Added: ${data.results[0]!.title}`, exact: true })).toBeDisabled()
})

test('Check now pressed twice runs once, failure is visible and a retry succeeds', async ({ page }) => {
  const device = await serveDevice(page, {design:'watchlist',delay:200})
  await page.goto('/series')
  const check = page.getByRole('button',{name:'Check now: Dragnet',exact:true})
  device.failNext('series.checkNow','Connection dropped')
  await check.evaluate(b => { (b as HTMLButtonElement).click(); (b as HTMLButtonElement).click() })
  await expect(page.getByText(/Connection dropped/)).toBeVisible()
  await expect(check).toBeEnabled()
  expect(device.calls.filter(c=>c==='series.checkNow')).toHaveLength(1)
  await check.click()
  await expect(page.getByText('Check completed')).toBeVisible()
  expect(device.calls.filter(c=>c==='series.checkNow')).toHaveLength(2)
})

test('orbits cover one and sixty episodes, same-day airings share a label, absent dates stay absent', async ({ page }) => {
  const device = await serveDevice(page,{design:'watchlist'})
  await page.goto('/series')
  await expect(page.getByRole('list', { name: 'Series', exact: true }).getByRole('listitem')).toHaveCount(3)
  const tasks = infallSeries()
  tasks[0]!.episodes.episodes = tasks[0]!.episodes.episodes.slice(0,1)
  tasks[0]!.episodes.total = 1
  tasks[1]!.episodes.episodes = Array.from({length:60},(_,i)=>({number:i+1,name:null,state:'expected',airstamp:new Date().toISOString()}))
  tasks[1]!.episodes.total = 60
  device.send('series.changed',tasks)
  const one = page.getByRole('img', { name: '1 of 1 episode', exact: true })
  await expect(one).toBeVisible()
  expect(await one.evaluate(svg => svg.querySelectorAll('path').length)).toBe(1)
  const sixty = page.getByRole('img', { name: '0 of 60 episodes', exact: true })
  expect(await sixty.evaluate(svg => svg.querySelectorAll('path').length)).toBe(60)
  const dated = page.getByRole('img', { name: /^1:.*60:/ })
  await expect(dated).toHaveCount(1)
  const finished = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: 'Caminandes', exact: true }) })
  await expect(finished.getByRole('img')).toHaveCount(1)

})

test('Files keeps deep Unicode paths readable on a phone, bounds a 5000-item folder and handles disappearance', async ({ page }) => {
  await page.setViewportSize({width:390,height:780})
  const device = await serveDevice(page)
  const deep = '/downloads/' + Array.from({length:12},(_,i)=>`مجلد-é-${i}`).join('/')
  device.setReply('fs.browse',{path:deep,root:'/downloads',separator:'/',entries:Array.from({length:250},(_,i)=>({name:`ملف-é-${i}.txt`,kind:'file',size:1,modified:null,media:null,download:null})),offset:0,total:5000,truncated:false})
  // A long folder is windowed: 250 entries read, a screenful of them in the page.
  const windowed = async () => {
    await expect(page.getByRole('list', { name: /^Contents of / }).getByRole('listitem').first()).toHaveAttribute('aria-setsize', '250')
    expect(await page.getByRole('list', { name: /^Contents of / }).getByRole('listitem').count()).toBeLessThan(30)
  }
  await page.goto('/files')
  await windowed()
  await page.evaluate(path => history.replaceState({ ...history.state, usr: { path } }, ''), deep)
  await page.reload()
  await windowed()
  await expect(page.getByRole('navigation',{name:'Folder path'})).toContainText('مجلد-é-11')
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(390)
  // Refresh sits under the list on a phone: getting to it brings the list's end near, which may read more first.
  device.failNext('fs.browse','Folder was removed','test_failure',params => params.offset === undefined)
  await page.getByRole('button',{name:'Refresh',exact:true}).click()
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page.getByRole('alert')).toContainText('Folder was removed')
  await page.getByRole('button',{name:'Try again',exact:true}).click()
  await windowed()
})

for (const theme of ['dark','light'] as const) test(`new pages stay usable by keyboard in ${theme}`, async ({ page }) => {
  await page.emulateMedia({colorScheme:theme,reducedMotion:'reduce'})
  await serveDevice(page,{design:'watchlist'})
  for (const path of ['/search','/series','/files']) {
    await page.goto(path)
    await expect(page.getByRole('banner')).toBeVisible()
    await expectVisibleTabStops(page)
    await expectNoInvisibleClickTargets(page)
    await page.getByRole('main').getByRole('button', { disabled: false }).or(page.getByRole('main').getByRole('radio', { checked: true })).first().focus()
    await page.keyboard.press('Tab')
    const ring = await page.evaluate(() => {
      const active = document.activeElement!
      const style = getComputedStyle(active)
      return { visible: active.matches(':focus-visible'), width: Number.parseFloat(style.outlineWidth), style: style.outlineStyle }
    })
    expect(ring.visible).toBe(true)
    expect(ring.style).not.toBe('none')
    expect(ring.width).toBeGreaterThanOrEqual(2)
  }
})

test('a pending search reply survives leaving the page and cannot replace a newer search', async ({page}) => {
  const device = await serveDevice(page, {design:'search-start',manualSearch:true})
  const releaseFirst = device.holdNext('search.start')
  await page.goto('/search/sintel')
  await expect.poll(() => device.calls.filter(c=>c==='search.start').length).toBe(1)
  await page.getByRole('radio',{name:'720p',exact:true}).click()
  await expect.poll(() => device.calls.filter(c=>c==='search.start').length).toBe(2)
  releaseFirst()
  const data = infallSearch('search')
  device.send('search.results',{searchId:'search1',results:[{...data.results[0]!,title:'Superseded'}]})
  device.send('search.results',{searchId:'search2',results:[data.results[2]!]})
  await expect(page.getByRole('list', { name: 'Search', exact: true }).getByRole('heading', { level: 2 })).toHaveText([data.results[2]!.title])
  device.send('search.done',{searchId:'search2',error:null})
  await expect(page.getByRole('button',{name:'Search',exact:true})).toBeEnabled()
  const releaseThird = device.holdNext('search.start')
  await page.getByRole('button',{name:'Search',exact:true}).click()
  await expect.poll(() => device.calls.filter(c=>c==='search.start').length).toBe(3)
  await page.getByRole('link',{name:'Watchlist',exact:true}).click()
  releaseThird()
  await page.getByRole('link',{name:'Search',exact:true}).click()
  device.send('search.results',{searchId:'search3',results:[data.results[0]!]})
  device.send('search.done',{searchId:'search3',error:null})
  await expect(page.getByRole('list', { name: 'Search', exact: true }).getByRole('heading', { level: 2 })).toHaveText([data.results[0]!.title])
})

test('an air date crosses midnight in the viewer zone while the watchlist stays open', async ({page}) => {
  await page.clock.install({time:new Date('2026-10-14T23:59:45+02:00')})
  const device = await serveDevice(page,{design:'watchlist'})
  await page.goto('/series')
  await expect(page.getByRole('list', { name: 'Series', exact: true }).getByRole('listitem')).toHaveCount(3)
  const tasks = infallSeries()
  tasks[1]!.episodes.episodes = [{number:7,name:null,state:'expected',airstamp:'2026-10-15T00:00:00+02:00'}]
  device.send('series.changed',tasks)
  const approach = page.getByRole('img', { name: /^7:/ })
  await expect(approach).not.toHaveClass(/\bnow\b/)
  await page.clock.runFor(60_000)
  await expect(approach).toHaveClass(/\bnow\b/)
})

test('the Polish Watchlist heading and actions fit a phone without horizontal scrolling', async ({page}) => {
  await page.setViewportSize({width:390,height:780})
  await serveDevice(page,{design:'watchlist',language:'pl'})
  await page.goto('/series')
  await expect(page.getByRole('heading',{name:'Obserwowane',exact:true})).toBeVisible()
  await expect(page.getByRole('list', { name: 'Seriale', exact: true }).getByRole('listitem')).toHaveCount(3)
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(390)
  await expect(page.getByRole('main').getByRole('button', { name: /Dodaj serial|Czekaj na wydanie/ })).toHaveCount(2)
  for (const button of await page.getByRole('main').getByRole('button', { name: /Dodaj serial|Czekaj na wydanie/ }).all()) {
    const box = await button.boundingBox()
    expect(box!.x).toBeGreaterThanOrEqual(16)
    expect(box!.x+box!.width).toBeLessThanOrEqual(374)
  }
})

test('a watchlist push cannot be overwritten by its older initial read', async ({page}) => {
  const device = await serveDevice(page,{design:'watchlist'})
  const release = device.holdNext('series.list')
  await page.goto('/series')
  await expect(page.getByText('Reading the watchlist',{exact:true})).toBeVisible()
  const tasks = infallSeries()
  tasks[0]!.name = 'Updated series'
  device.send('series.changed',tasks)
  await expect(page.getByRole('list', { name: 'Series', exact: true }).getByRole('heading', { level: 2 }).first()).toHaveText('Updated series')
  release()
  await page.getByRole('button',{name:'Check now: Updated series',exact:true}).click()
  await expect(page.getByText('Check completed',{exact:true})).toBeVisible()
  await expect(page.getByRole('list', { name: 'Series', exact: true }).getByRole('heading', { level: 2 }).first()).toHaveText('Updated series')
})

test('the episode sentence follows a paused or failed download rather than claiming it is downloading', async ({page}) => {
  const device = await serveDevice(page,{design:'watchlist'})
  await page.goto('/series')
  const show = page.getByRole('list', { name: 'Series', exact: true }).getByRole('listitem').first()
  await expect(show).toContainText('Episode 10 is downloading.')
  const download = device.downloads()[0]!
  device.send('downloads.updated',[{...download,status:'Paused'}])
  await expect(show).toContainText('Episode 10 is paused.')
  device.send('downloads.updated',[{...download,status:'Error'}])
  await expect(show).toContainText('Episode 10 could not be downloaded.')
})

test('a search replaced before the computer answered is stopped on the computer', async ({ page }) => {
  const device = await serveDevice(page, { design: 'search-start', manualSearch: true })
  await page.goto('/search')
  const release = device.holdNext('search.start')
  await page.getByRole('searchbox').fill('sintel')
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  await expect.poll(() => device.calls.filter(c => c === 'search.start').length).toBe(1)
  await page.getByRole('radio', { name: '720p', exact: true }).click()
  await expect.poll(() => device.calls.filter(c => c === 'search.start').length).toBe(2)
  release()
  await expect.poll(() => device.log.filter(c => c.method === 'search.cancel').map(c => c.params.searchId)).toEqual(['search1'])
  const data = infallSearch('search')
  device.send('search.results', { searchId: 'search2', results: [data.results[2]!] })
  await expect(page.getByRole('list', { name: 'Search', exact: true }).getByRole('heading', { level: 2 })).toHaveText([data.results[2]!.title])
})

test('a finished rule offers no Check now; one still running does', async ({ page }) => {
  await serveDevice(page, { design: 'watchlist' })
  await page.goto('/series')
  await expect(page.getByRole('button', { name: 'Check now: Dragnet' })).toHaveCount(1)
  await expect(page.getByRole('list', { name: 'Series', exact: true }).getByRole('listitem').filter({ hasText: 'Caminandes' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Check now: Caminandes' })).toHaveCount(0)
})

test('every segmented appearance has one tab stop, wrapped arrow keys and boundary keys', async ({ page }) => {
  await serveDevice(page, { design: 'watchlist' })
  await page.goto('/series')
  const tabs = page.getByRole('radiogroup', { name: 'Watchlist', exact: true })
  const series = tabs.getByRole('radio', { name: 'Series', exact: true })
  await expect(series).toHaveAttribute('tabindex', '0')
  await expect(tabs.getByRole('radio', { name: 'Films & more', exact: true })).toHaveAttribute('tabindex', '-1')
  await page.getByRole('button', { name: 'Add a series', exact: true }).click()
  const choices = page.getByRole('dialog').getByRole('radiogroup', { name: 'Start with', exact: true })
  const options = choices.getByRole('radio')
  await options.first().focus()
  await page.keyboard.press('ArrowLeft')
  await expect(options.last()).toBeChecked()
  await expect(options.last()).toBeFocused()
  await expect(options.first()).toHaveAttribute('tabindex', '-1')
  await page.keyboard.press('Home')
  await expect(options.first()).toBeChecked()
  await page.keyboard.press('End')
  await expect(options.last()).toBeChecked()
})

test('a result uses the same decimal size in its row, details and folder chooser', async ({ page }) => {
  await serveDevice(page, { design: 'search' })
  await page.goto('/search/sintel')
  const title = 'Sintel (2010) 1080p BluRay x264'
  const row = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: title, exact: true }) })
  await expect(row).toContainText('1.9 GB')
  await row.getByRole('button', { name: title, exact: true }).click()
  const details = page.getByRole('dialog')
  await expect(details.getByText('1.9 GB', { exact: true })).toBeVisible()
  await details.getByRole('button', { name: 'Download', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Download to', exact: true }).getByText('1.9 GB', { exact: true })).toBeVisible()
})

test('release checks lock before paint and unlock after a rejected request', async ({ page }) => {
  const device = await serveDevice(page, { design: 'watchlist', delay: 150 })
  await page.goto('/series/releases')
  const check = page.getByRole('button', { name: 'Check now', exact: true })
  device.failNext('watches.checkNow', 'Release check disconnected')
  await check.evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click() })
  await expect(page.getByText(/Release check disconnected/)).toBeVisible()
  expect(device.calls.filter(call => call === 'watches.checkNow')).toHaveLength(1)
  await expect(check).toBeEnabled()
  await check.click()
  await expect(page.getByText('Nothing that fits yet', { exact: true })).toBeVisible()
  expect(device.calls.filter(call => call === 'watches.checkNow')).toHaveLength(2)
})

for (const remote of [false, true]) test(`navigation keeps one current place on nested routes, remote=${remote}`, async ({ page }) => {
  await serveDevice(page, { design: 'downloads', remote })
  const base = remote ? '/Mac-Mini-M1' : ''
  const menu = page.getByRole('navigation', { name: 'Menu', exact: true })
  for (const [path, name] of [['/downloads/1', 'Downloads'], ['/search/sintel?res=720p', 'Search'], ['/series/releases', 'Watchlist'], ['/files', 'Files'], ['/settings/downloads', 'Settings']]) {
    await page.goto(base + path)
    await expect(menu.getByRole('link').and(page.locator('[aria-current="page"]'))).toHaveCount(1)
    await expect(menu.getByRole('link').and(page.locator('[aria-current="page"]'))).toHaveText(new RegExp(`^${name}(?:\\s*\\d+)?$`))
  }
})

test('download pushes reuse folder rows and the details file list while updating owned progress', async ({ page }) => {
  await page.clock.install()
  await page.addInitScript(() => {
    type Fiber = { flags: number; elementType?: { $$typeof?: symbol }; memoizedProps?: { entry?: unknown; hasMetadata?: boolean }; child?: Fiber; sibling?: Fiber }
    const rendered: string[] = []
    Object.assign(window, { fileRenders: rendered, __REACT_DEVTOOLS_GLOBAL_HOOK__: {
      supportsFiber: true, inject: () => 1, onCommitFiberUnmount: () => {},
      onCommitFiberRoot: (_id: number, root: { current: Fiber }) => {
        const walk = (fiber?: Fiber) => {
          if (!fiber) return
          if (fiber.elementType?.$$typeof === Symbol.for('react.memo') && (fiber.flags & 1)) {
            if (fiber.memoizedProps?.entry) rendered.push('entry')
            if (fiber.memoizedProps?.hasMetadata !== undefined) rendered.push('files')
          }
          walk(fiber.child); walk(fiber.sibling)
        }
        walk(root.current)
      },
    } })
  })
  const device = await serveDevice(page, { design: 'files' })
  await page.goto('/files')
  await expect(page.getByRole('list', { name: /^Contents of / }).getByRole('listitem')).not.toHaveCount(0)
  const rendered = () => page.evaluate(() => (window as unknown as { fileRenders: string[] }).fileRenders)
  expect(await rendered()).toContain('entry')
  await page.evaluate(() => { (window as unknown as { fileRenders: string[] }).fileRenders.length = 0 })
  device.send('downloads.updated', [{ ...device.downloads()[0]!, progress: 65 }])
  await expect(page.getByText('Still downloading, 65%', { exact: true })).toBeVisible()
  expect(await rendered()).toEqual([])
  await page.goto('/downloads/1')
  await expect(page.getByRole('checkbox')).toHaveCount(5)
  expect(await rendered()).toContain('files')
  await page.evaluate(() => { (window as unknown as { fileRenders: string[] }).fileRenders.length = 0 })
  device.send('downloads.updated', [{ ...device.downloads()[0]!, progress: 66 }])
  await expect(page.getByRole('main')).toContainText('66%')
  expect(await rendered()).toEqual([])
})

for (const language of ['en', 'pl']) {
  test(`the main screens fit a phone in ${language}, also in a wide font`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 780 })
    // Each screen is measured in the asked language with what it lists drawn, not while it still loads.
    const screens = [
      ['downloads', '/', () => page.locator('main .download-row').first()],
      ['details-fail', '/downloads/5', () => page.getByRole('heading', { level: 1, name: 'Night of the Living Dead (1968)' })],
      ['search', '/search/sintel', () => page.locator('main h2').filter({ hasText: /sintel/i }).first()],
      ['watchlist', '/series', () => page.locator('main').getByText('Dragnet').first()],
      ['files', '/files', () => page.locator('main').getByText('/Users/alex/Movies').first()],
    ] as const
    for (const [design, path, ready] of screens) {
      await page.unrouteAll({ behavior: 'ignoreErrors' })
      await serveDevice(page, { design, language })
      await page.goto(path)
      await expect(page.locator('html')).toHaveAttribute('lang', language)
      await ready().waitFor()
      // Until the page's own fonts arrive (or where a phone blocks them) a wider one stands in: Linux has DejaVu Sans.
      await page.addStyleTag({ content: '* { font-family: Verdana, "DejaVu Sans", sans-serif !important }' })
      const wide = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
      expect(wide, `${design} in ${language}`).toBeLessThanOrEqual(0)
    }
  })
}
