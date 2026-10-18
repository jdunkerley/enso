/** @file Actions for the user menu. */
import type BaseActions from './BaseActions'
import type { BaseActionsClass, PageCallback } from './BaseActions'
import SettingsPageActions from './SettingsPageActions'
import { TEXT } from './utilities'

/** Actions for the user menu. */
export interface UserMenuActions<Context> {
  readonly settings: () => SettingsPageActions<Context>
}

/** Generate actions for the user menu. */
export function userMenuActions<
  Context,
  T extends BaseActions<Context, ParentClass>,
  ParentClass extends BaseActionsClass<Context>,
>(step: (name: string, callback: PageCallback<Context, T>) => T): UserMenuActions<Context> {
  return {
    settings: () =>
      step('Go to Settings (user menu)', async (page) => {
        await page
          .getByRole('button', { name: TEXT.settingsShortcut })
          .getByText(TEXT.settingsShortcut)
          .click()
      }).into(SettingsPageActions<Context>),
  }
}
