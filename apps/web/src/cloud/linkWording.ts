/**
 * What the not-linked screen calls itself. An installed app is "this app" to the person holding it, and a tab is
 * "this browser"; the device lists both as browsers.
 */
export function linkTitle(installed: boolean): string {
  return installed ? 'link.notLinkedTitleApp' : 'link.notLinkedTitle'
}
