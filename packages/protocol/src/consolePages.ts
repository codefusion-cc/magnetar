/**
 * The website's screens as CodeFusion Console counts their visits and files their failures. The Worker
 * accepts only these names (createConsoleRoutes); anything else arrives as "other".
 */
export const CONSOLE_PAGES = [
  'home',
  'about',
  'login',
  'pair',
  'link',
  'add',
  'features',
  'devices',
  'device-downloads',
  'device-search',
  'device-series',
  'device-settings',
  'device-files',
] as const

export type ConsolePage = (typeof CONSOLE_PAGES)[number]

const DEVICE_TABS = new Set(['search', 'series', 'settings', 'files'])
/** The website's own top-level pages, which no device may be named after (device-names.json). */
export const SITE_PAGES = new Set(['about', 'login', 'pair', 'link', 'add', 'features'])
/** The screens someone signed out sees; any other they reach on the way to /login, which counts it. */
export const PUBLIC_PAGES: ReadonlySet<ConsolePage> = new Set<ConsolePage>(['home', 'login', 'pair', 'link', 'features'])

/**
 * The screen a website path shows (`/MacBook-Pro/search/dragon` is device-search), never a name or id from it. `/` is
 * the first page to someone signed out and their computers to someone signed in.
 */
export function consolePage(pathname: string, signedIn: boolean): ConsolePage {
  const [, first = '', ...rest] = pathname.split('/')
  if (SITE_PAGES.has(first)) return first as ConsolePage
  if (!first) return signedIn ? 'devices' : 'home'
  // A device by name, or by id under /d/ on its way to its name.
  const tab = (first === 'd' ? rest[1] : rest[0]) ?? ''
  return DEVICE_TABS.has(tab) ? (`device-${tab}` as ConsolePage) : 'device-downloads'
}
