import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test, vi } from 'vitest'

test('the wait for the account is in the browser language', async () => {
  vi.stubGlobal('__APP_COMMIT__', '')
  vi.stubGlobal('navigator', { languages: ['pl-PL'], language: 'pl-PL' })
  const { loadCatalog } = await import('../lib/i18n.tsx')
  await loadCatalog('pl')
  const { default: CloudApp } = await import('./CloudApp.tsx')
  const html = renderToStaticMarkup(createElement(CloudApp, { config: {} as never }))
  expect(html).toContain('Wczytywanie')
  expect(html).not.toContain('Loading')
})
