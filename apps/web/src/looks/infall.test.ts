import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { contrast, lookColors } from '@codefusion-cc/ui/looks'
import { assertLook } from '@codefusion-cc/ui/testing'
import { describe, expect, it } from 'vitest'
import infall from './infall.ts'

/** Each daisyUI theme in index.css, as the role each of its colours reads (`--color-error` → `--cf-danger`). */
function daisyThemes(): Map<string, Map<string, string>> {
  const css = readFileSync(join(import.meta.dirname, '../index.css'), 'utf8')
  const themes = new Map<string, Map<string, string>>()
  for (const [, body] of css.matchAll(/@plugin "daisyui\/theme" \{([^}]*)\}/g)) {
    const name = /name: "([^"]+)"/.exec(body!)![1]!
    themes.set(name, new Map([...body!.matchAll(/(--color-[a-z0-9-]+): var\((--[a-z0-9-]+)\)/g)].map(([, color, role]) => [color!, role!])))
  }
  return themes
}

describe('the Infall look', () => {
  it('passes the kit: every role in both modes, every text pair at 4.5:1, every part at 3:1', () => {
    assertLook(infall)
  })

  it('gives daisyUI only the look’s roles, the same in both themes', () => {
    const themes = daisyThemes()
    expect([...themes.keys()].sort()).toEqual(['magnetar-dark', 'magnetar-light'])
    const [light, dark] = [themes.get('magnetar-light')!, themes.get('magnetar-dark')!]
    expect(light.size).toBe(20)
    expect([...light]).toEqual([...dark])
    for (const role of light.values()) expect(lookColors(infall, 'light').has(role), role).toBe(true)
  })

  // The kit measures text on the page and the tones' tints; daisyUI also fills a badge, a button or an alert with a
  // tone and writes its -content on it.
  it.each(['light', 'dark'] as const)('keeps every daisyUI fill readable in %s', mode => {
    const colors = lookColors(infall, mode)
    const roles = daisyThemes().get(`magnetar-${mode}`)!
    const failing: string[] = []
    for (const [color, role] of roles) {
      if (!color.endsWith('-content')) continue
      const fill = color === '--color-base-content' ? roles.get('--color-base-100')! : roles.get(color.replace(/-content$/, ''))!
      const ratio = contrast(colors.get(role)!, [colors.get(fill)!])
      if (ratio < 4.5) failing.push(`${color} on ${fill}: ${ratio.toFixed(2)}`)
    }
    expect(failing).toEqual([])
  })
})
