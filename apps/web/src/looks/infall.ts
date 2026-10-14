import { defineAppTokens, defineLook } from '@codefusion-cc/ui/looks'

/** The star's colours in each mode: the fallbacks of its tokens and the values Infall gives them. */
const star = {
  core: ['The star: the computer, lit.', '#1d1410', '#fff3dc'],
  void: ['The inside of a star that is out.', '#fbf7f1', '#000000'],
  ring: ['The edge of a star that is out.', 'rgb(60 30 15 / 0.6)', 'rgb(255 200 150 / 0.5)'],
  far: ['A star out of reach: the computer while it cannot be reached.', '#a8261b', '#d2553a'],
  'far-glow': ['The glow around a star out of reach.', 'rgb(168 38 27 / 0.3)', 'rgb(190 52 30 / 0.5)'],
  h0: ['Heat far from the star: the cold end of a lane.', '#e0b79c', '#7a2414'],
  h1: ['Heat on the way: what is moving now.', '#b8430f', '#ff7e30'],
  h2: ['Heat at the star: white hot.', '#1d1410', '#fff4e0'],
  seg: ['A lane or an arc not travelled yet.', '#d6c9ba', '#3a2c26'],
} as const
const glow = {
  halo: ["The star's glow.", '0 0 8px 2px rgb(184 67 15 / 0.55), 0 0 26px 9px rgb(184 67 15 / 0.2)', '0 0 9px 3px #ffc27a, 0 0 30px 11px rgb(255 126 48 / 0.42)'],
  'halo-small': ["A small star's glow, as in the mark.", '0 0 5px 1px rgb(184 67 15 / 0.55), 0 0 14px 5px rgb(184 67 15 / 0.2)', '0 0 6px 2px #ffc27a, 0 0 16px 6px rgb(255 126 48 / 0.4)'],
} as const
type StarName = keyof typeof star | keyof typeof glow
const entries = [...Object.entries(star), ...Object.entries(glow)] as [StarName, readonly [string, string, string]][]
const inMode = (mode: 1 | 2) => Object.fromEntries(entries.map(([name, values]) => [name, values[mode]])) as Record<StarName, string>

/**
 * The star's own tokens, beside the contract's roles: what is drawn (the computer as a star, what falls into it, the
 * season's orbit). Heat runs from `h0` (far, cold) through `h1` to `h2` (white, at the star); `core` is the star,
 * `void` and `ring` a star that is out, `far` one out of reach, `seg` a lane or an arc not travelled yet.
 */
export const mg = defineAppTokens(
  'mg',
  {
    ...(Object.fromEntries(Object.entries(star).map(([name, [description, light, dark]]) => [name, { type: 'color', description, fallback: { light, dark } }])) as Record<keyof typeof star, { type: 'color'; description: string; fallback: { light: string; dark: string } }>),
    ...(Object.fromEntries(Object.entries(glow).map(([name, [description, light, dark]]) => [name, { type: 'shadow', description, fallback: { light, dark } }])) as Record<keyof typeof glow, { type: 'shadow'; description: string; fallback: { light: string; dark: string } }>),
  },
  { pairs: [{ fg: '--mg-h1', bg: '--cf-page', kind: 'ui' }, { fg: '--mg-core', bg: '--cf-page', kind: 'ui' }] },
)

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
  app: { tokens: mg, light: inMode(1), dark: inMode(2) },
})
