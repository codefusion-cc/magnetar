import type { MouseEvent } from 'react'
import { flushSync } from 'react-dom'
import { createTheme, revealThemeChange } from '@codefusion-cc/theme/browser'
import { themeConfig } from './themeConfig.ts'

/** The page's theme: follows the system and the other tabs; `useTheme(theme)` from @codefusion-cc/theme/react reads it. */
export const theme = createTheme(themeConfig)

/**
 * A change of theme as the new one growing in a circle from the click, or from the control when the keyboard pressed
 * it or only the control is known. Shorter on touch: while it runs, the page takes no taps. At once with reduced motion.
 */
export function revealChange(from: MouseEvent<HTMLElement> | HTMLElement, apply: () => void) {
  const origin = !('nativeEvent' in from) ? from : from.detail ? { x: from.clientX, y: from.clientY } : from.currentTarget
  return revealThemeChange(() => flushSync(apply), {
    origin,
    duration: matchMedia('(pointer: coarse)').matches ? 400 : undefined,
  })
}
