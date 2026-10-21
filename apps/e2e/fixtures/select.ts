import type { Page } from '@playwright/test'

/** The dashboard's own menu named `name`. */
export const combobox = (page: Page, name: string | RegExp) => page.getByRole('combobox', { name })
/** The open menu's list. */
export const listbox = (page: Page) => page.getByRole('listbox')

/** Picks `option` in the menu named `name`, as a person does: open it, then click the option. */
export async function pick(page: Page, name: string | RegExp, option: string) {
  await combobox(page, name).click()
  await listbox(page).getByRole('option', { name: option, exact: true }).click()
}
