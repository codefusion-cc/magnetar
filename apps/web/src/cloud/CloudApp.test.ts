import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test, vi } from 'vitest'
import { loadCatalog } from '../lib/i18n.tsx'
import CloudApp from './CloudApp.tsx'

test('the wait for the account is in the browser language', async () => {
  vi.stubGlobal('navigator', { languages: ['pl-PL'], language: 'pl-PL' })
  await loadCatalog('pl')
  const html = renderToStaticMarkup(createElement(CloudApp, { config: {} as never }))
  expect(html).toContain('Wczytywanie')
  expect(html).not.toContain('Loading')
})
