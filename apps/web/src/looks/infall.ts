import { defineAppTokens, defineLook } from '@codefusion-cc/ui/looks'

/**
 * The star's own tokens, beside the contract's roles: what is drawn (the computer as a star, what falls into it, the
 * season's orbit). Heat runs from `h0` (far, cold) through `h1` to `h2` (white, at the star); `core` is the star,
 * `void` and `ring` a star that is out, `far` one out of reach, `seg` a lane or an arc not travelled yet. Their values
 * are Infall's, given once here as the fallbacks, and Infall takes them as they are (`starIn`).
 */
export const mg = defineAppTokens(
  'mg',
  {
    core: { type: 'color', description: 'The star: the computer, lit.', fallback: { light: '#1d1410', dark: '#fff3dc' } },
    void: { type: 'color', description: 'The inside of a star that is out.', fallback: { light: '#fbf7f1', dark: '#000000' } },
    ring: { type: 'color', description: 'The edge of a star that is out.', fallback: { light: 'rgb(60 30 15 / 0.6)', dark: 'rgb(255 200 150 / 0.5)' } },
    far: { type: 'color', description: 'A star out of reach: the computer while it cannot be reached.', fallback: { light: '#a8261b', dark: '#d2553a' } },
    'far-glow': { type: 'color', description: 'The glow around a star out of reach.', fallback: { light: 'rgb(168 38 27 / 0.3)', dark: 'rgb(190 52 30 / 0.5)' } },
    h0: { type: 'color', description: 'Heat far from the star: the cold end of a lane.', fallback: { light: '#e0b79c', dark: '#7a2414' } },
    h1: { type: 'color', description: 'Heat on the way: what is moving now.', fallback: { light: '#b8430f', dark: '#ff7e30' } },
    h2: { type: 'color', description: 'Heat at the star: white hot.', fallback: { light: '#1d1410', dark: '#fff4e0' } },
    seg: { type: 'color', description: 'A lane or an arc not travelled yet.', fallback: { light: '#d6c9ba', dark: '#3a2c26' } },
    'heat-from': { type: 'color', description: 'Where a lane of heat starts, far from the star.', fallback: { light: '#e0b79c', dark: '#cc381c' } },
    'heat-mid': { type: 'color', description: 'A lane of heat close to the star, before it turns white.', fallback: { light: '#5a1d08', dark: '#ffd08a' } },
    halo: {
      type: 'shadow',
      description: "The star's glow.",
      fallback: { light: '0 0 8px 2px rgb(184 67 15 / 0.55), 0 0 26px 9px rgb(184 67 15 / 0.2)', dark: '0 0 9px 3px #ffc27a, 0 0 30px 11px rgb(255 126 48 / 0.42)' },
    },
    'halo-small': {
      type: 'shadow',
      description: "A small star's glow, as in the mark.",
      fallback: { light: '0 0 5px 1px rgb(184 67 15 / 0.55), 0 0 14px 5px rgb(184 67 15 / 0.2)', dark: '0 0 6px 2px #ffc27a, 0 0 16px 6px rgb(255 126 48 / 0.4)' },
    },
  },
  { pairs: [{ fg: '--mg-h1', bg: '--cf-page', kind: 'ui' }, { fg: '--mg-core', bg: '--cf-page', kind: 'ui' }] },
)

/** The star's fallbacks in one mode, as a look's values. */
const starIn = (mode: 'light' | 'dark') =>
  Object.fromEntries(Object.entries(mg.roles).map(([name, role]) => [name, role.fallback[mode]])) as { [K in keyof typeof mg.roles]: string }

/**
 * Infall: everything downloaded falls into one star, the computer. Dark is black, and the only colour is heat: red far
 * from the star, white next to it, blue-white (`ok`) for what is finished. Light is the same sky as a photographic
 * plate: paper ground, the star and everything hot drawn dark. Unbounded for the few large lines, Golos Text for
 * everything read. No cards and no shadows: rows are separated by one rule.
 */
export default defineLook({
  name: 'infall',
  light: {
    page: '#f2ebe1',
    surface: '#fbf7f1',
    raised: '#e4d9cb',
    ink: '#1d1410',
    muted: '#66574d',
    line: '#d6c9ba',
    accent: '#1d1410',
    'accent-2': '#8a3a0c',
    'on-accent': '#fbf7f1',
    inverse: '#1d1410',
    'on-inverse': '#f2ebe1',
    media: '#e4d9cb',
    focus: 'var(--cf-accent-2)',
    ok: '#1d4d78',
    warn: '#8a3a0c',
    danger: '#a8261b',
    info: '#b8430f',
    'chart-1': '#b8430f',
    'chart-2': '#1d4d78',
    'chart-3': '#8a3a0c',
    'chart-4': '#a8261b',
    'chart-5': '#5a1d08',
    'chart-6': '#66574d',
    'shadow-card': 'none',
    'shadow-lift': '0 0 0 1px #d6c9ba, 0 18px 40px -12px rgb(29 20 16 / 0.28)',
  },
  dark: {
    page: '#070505',
    surface: '#151010',
    raised: '#1e1714',
    ink: '#f4ede5',
    muted: '#ab9e94',
    line: '#2c2320',
    accent: '#ffd9a0',
    'accent-2': '#ffd08a',
    'on-accent': '#1c0e05',
    inverse: '#f4ede5',
    'on-inverse': '#070505',
    media: '#151010',
    focus: 'var(--cf-accent-2)',
    ok: '#cfe4ff',
    warn: '#ffd08a',
    danger: '#ff8f76',
    info: '#ff7e30',
    'chart-1': '#ff7e30',
    'chart-2': '#cfe4ff',
    'chart-3': '#ffd08a',
    'chart-4': '#ff8f76',
    'chart-5': '#d2553a',
    'chart-6': '#ab9e94',
    'shadow-card': 'none',
    'shadow-lift': '0 0 0 1px #2c2320, 0 18px 40px -12px rgb(0 0 0 / 0.8)',
  },
  both: {
    'font-display': '"Unbounded", ui-sans-serif, system-ui, sans-serif',
    'font-body': '"Golos Text", ui-sans-serif, system-ui, sans-serif',
    'font-mono': 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
    'radius-card': '10px',
    'radius-ctl': '8px',
    'control-touch': '46px',
    'control-mouse': '38px',
    'duration-press': '90ms',
    'duration-quick': '160ms',
    'duration-move': '280ms',
    'duration-settle': '480ms',
    'ease-out': 'cubic-bezier(0.2, 0.7, 0.2, 1)',
    'ease-in': 'cubic-bezier(0.4, 0, 1, 1)',
    'ease-state': 'cubic-bezier(0.34, 1.3, 0.5, 1)',
  },
  app: { tokens: mg, light: starIn('light'), dark: starIn('dark') },
})
