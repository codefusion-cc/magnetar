/** What `isInstalledApp` asks of the page; the browser's own by default. */
interface Page {
  matchMedia?: (query: string) => { matches: boolean }
  /** Safari's `standalone` is no part of the standard `Navigator`. */
  navigator?: object
}

/**
 * Whether the page runs as an installed web app, in a window of its own, rather than in a browser tab. Safari on
 * iOS says so with `navigator.standalone`, the others with the display mode. To the person holding it that is an app,
 * not a browser, and on iOS it shares no storage with the browser.
 */
export function isInstalledApp(page: Page = globalThis): boolean {
  return page.matchMedia?.('(display-mode: standalone)').matches === true || (page.navigator as { standalone?: boolean } | undefined)?.standalone === true
}
