/**
 * The texts that name what is being linked. An installed app is "this app" to the person holding it, and a tab is
 * "this browser"; the device lists both as browsers.
 */
export function linkWording(installed: boolean): { title: string; submit: string } {
  return installed
    ? { title: 'link.notLinkedTitleApp', submit: 'link.submitApp' }
    : { title: 'link.notLinkedTitle', submit: 'link.submit' }
}
