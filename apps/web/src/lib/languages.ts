/** Every language by its own name. English is built in; the others load when chosen (see i18n.tsx). */
export const LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'pl', name: 'Polski' },
]

/** `code` when the dashboard is written in it, else English (a language saved before it was dropped). */
export const shownLanguage = (code: string) => LANGUAGES.some(l => l.code === code) ? code : 'en'
