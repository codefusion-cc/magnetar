/** The public website the features page lives on; the app on a computer is not served from it, so it links there. */
const WEBSITE = 'https://magnetar.codefusion.cc'

/** The features page in the dashboard's language (`pl`, `pt-BR` → `pt`); the page itself falls back for one it is not written in. */
export function featuresUrl(language: string): string {
  const code = /^[a-z]{2}/i.exec(language)?.[0].toLowerCase()
  return code ? `${WEBSITE}/features/${code}` : `${WEBSITE}/features`
}
