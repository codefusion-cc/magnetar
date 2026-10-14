import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { contrast, formatHex, lookColors } from '@codefusion-cc/ui/looks'
import { assertLook } from '@codefusion-cc/ui/testing'
import { describe, expect, it } from 'vitest'
import infall from './infall.ts'

const css = readFileSync(join(import.meta.dirname, '../index.css'), 'utf8')

/** What each of daisyUI's colours reads in index.css's shared block (`--color-error` → `--cf-danger`). */
function daisyRoles(): Map<string, string> {
  const shared = /:root,\s*\[data-theme\] \{([^}]*)\}/.exec(css)![1]!
  return new Map([...shared.matchAll(/(--color-[a-z0-9-]+): var\((--[a-z0-9-]+)\)/g)].map(([, color, role]) => [color!, role!]))
}

describe('the Infall look', () => {
  it('passes the kit: every role in both modes, every text pair at 4.5:1, every part at 3:1', () => {
    assertLook(infall)
  })

  it('gives daisyUI only the look’s roles, and its themes no colours of their own', () => {
    const roles = daisyRoles()
    expect(roles.size).toBe(20)
    for (const role of roles.values()) expect(lookColors(infall, 'light').has(role), role).toBe(true)
    for (const [, theme] of css.matchAll(/@plugin "daisyui\/theme" \{([^}]*)\}/g)) expect(theme).not.toMatch(/--color-/)
  })

  // The kit measures text on the page and the tones' tints; daisyUI also fills a badge, a button or an alert with a
  // tone and writes its -content on it.
  it.each(['light', 'dark'] as const)('keeps every daisyUI fill readable in %s', mode => {
    const colors = lookColors(infall, mode)
    const roles = daisyRoles()
    const failing: string[] = []
    for (const [color, role] of roles) {
      if (!color.endsWith('-content')) continue
      const fill = color === '--color-base-content' ? roles.get('--color-base-100')! : roles.get(color.replace(/-content$/, ''))!
      const ratio = contrast(colors.get(role)!, [colors.get(fill)!])
      if (ratio < 4.5) failing.push(`${color} on ${fill}: ${ratio.toFixed(2)}`)
    }
    expect(failing).toEqual([])
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
