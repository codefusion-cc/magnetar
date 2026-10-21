import { useTheme } from '@codefusion-cc/theme/react'
import { Moon, Sun } from 'lucide-react'
import { useT } from '../lib/i18n.tsx'
import { revealChange, theme } from './theme.ts'

/**
 * Light or dark, the other one than shown, in every frame's top row: the sun in the dark, the moon in the light. Its name
 * says where it goes; Settings › General keeps following the system.
 */
export function ThemeToggle() {
  const t = useT()
  const { resolved } = useTheme(theme)
  const next = resolved === 'dark' ? 'light' : 'dark'
  const label = t(`theme.${next}`)
  return (
    <button type="button" className="theme-switch" onClick={event => void revealChange(event, theme.toggle)} aria-label={label} title={label}>
      {next === 'light' ? <Sun size={18} aria-hidden /> : <Moon size={18} aria-hidden />}
    </button>
  )
}
