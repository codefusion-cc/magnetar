/**
 * The features page's outline, the same in every language: its groups and features (their anchors),
 * the shots each one shows, and the entries of its own sections. Each language (content/*.ts) gives the words for
 * exactly these, so TypeScript finds a feature, shot or entry a translation misses.
 *
 * A new feature people can see gets an entry here and its words in every language; `pnpm --filter @magnetar/e2e run
 * screenshots` takes its shots (apps/e2e/features/screenshots.ts). What the page says must match the code.
 */
import type SIZES from './shots.json'

export type ShotName = keyof typeof SIZES

/** The shot beside the opening: the downloads, which is also the first thing the app is for. A feature shows it too (its alt text is there). */
export const HERO_SHOT = 'downloads' satisfies ShotName

export const OUTLINE = [
  {
    id: 'find',
    features: [
      { id: 'sources', shots: ['search', 'search-phone', 'search-sources'] },
      { id: 'addresses', shots: [] },
      { id: 'add', shots: ['add'] },
      { id: 'series', shots: ['watchlist'] },
      { id: 'watches', shots: ['watches'] },
    ],
  },
  {
    id: 'download',
    features: [
      { id: 'engine', shots: ['downloads'] },
      { id: 'destination', shots: ['save-folder'] },
      { id: 'files', shots: ['details'] },
      { id: 'play', shots: ['player'] },
      { id: 'browse', shots: [] },
      { id: 'speed', shots: ['speed'] },
      { id: 'kill-switch', shots: [] },
    ],
  },
  {
    id: 'anywhere',
    features: [
      { id: 'website', shots: ['devices', 'remote-phone'] },
      { id: 'pairing', shots: ['remote', 'pair'] },
      { id: 'phone', shots: ['link-qr'] },
      { id: 'device-addresses', shots: ['switcher'] },
      { id: 'install', shots: [] },
    ],
  },
  {
    id: 'notify',
    features: [
      { id: 'channels', shots: ['notifications'] },
      { id: 'push', shots: [] },
    ],
  },
  {
    id: 'app',
    features: [
      { id: 'desktop', shots: ['settings'] },
      { id: 'tray', shots: [] },
      { id: 'updates', shots: ['about'] },
      { id: 'agents', shots: ['agents'] },
      { id: 'reports', shots: [] },
      { id: 'import', shots: [] },
      { id: 'languages', shots: [] },
    ],
  },
] as const satisfies readonly { id: string; features: readonly { id: string; shots: readonly ShotName[] }[] }[]

/** The privacy section's entries. */
export const PRIVACY = ['e2e', 'worker', 'sealed', 'visits', 'local'] as const

/** What Magnetar is built on, one row each. */
export const BUILT_ON = ['client', 'engine', 'dashboard', 'worker', 'packages', 'console', 'releases'] as const

export type GroupId = (typeof OUTLINE)[number]['id']
type GroupOf<G extends GroupId> = Extract<(typeof OUTLINE)[number], { id: G }>
export type FeatureIdOf<G extends GroupId> = GroupOf<G>['features'][number]['id']
/** Every shot a feature shows, each once. */
export type FeatureShot = (typeof OUTLINE)[number]['features'][number]['shots'][number]
