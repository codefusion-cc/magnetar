import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { formatHex, lookColors } from '@codefusion-cc/ui/looks'
import { assertLook } from '@codefusion-cc/ui/testing'
import { describe, expect, it } from 'vitest'
import infall from './infall.ts'

describe('the Infall look', () => {
  it('passes the kit: every role in both modes, every text pair at 4.5:1, every part at 3:1', () => {
    assertLook(infall)
  })

  // Read before any script or stylesheet: the browser's bar while the page loads, and an installed app's splash.
  it('gives the page head and the manifest the look’s grounds', () => {
    const web = join(import.meta.dirname, '../..')
    const html = readFileSync(join(web, 'index.html'), 'utf8')
    const manifest = JSON.parse(readFileSync(join(web, 'public/manifest.webmanifest'), 'utf8')) as { background_color: string; theme_color: string }
    const page = (mode: 'light' | 'dark') => formatHex(lookColors(infall, mode).get('--cf-page')!)
    expect(/<meta name="theme-color" content="([^"]+)"/.exec(html)![1]).toBe(page('light'))
    expect([manifest.background_color, manifest.theme_color]).toEqual([page('dark'), page('dark')])
  })
})
