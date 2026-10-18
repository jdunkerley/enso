/** @file Actions for going to a different page. */
import type { PageCallback } from './BaseActions'
import BaseActions from './BaseActions'
import SettingsAccountTabActions from './SettingsAccountTabActions'
import SettingsKeyboardShortcutsTabActions from './SettingsKeyboardShortcutsTabActions'
import SettingsLocalTabActions from './SettingsLocalTabActions'
import { TEXT } from './utilities'

/** Actions for going to a different settings tab. */
export interface GoToSettingsTabActions<Context> {
  readonly account: () => SettingsAccountTabActions<Context>
  readonly local: () => SettingsLocalTabActions<Context>
  readonly keyboardShortcuts: () => SettingsKeyboardShortcutsTabActions<Context>
}

/** Generate actions for going to a different page. */
export function goToSettingsTabActions<Context, Self>(
  step: (name: string, callback: PageCallback<Context, Self>) => BaseActions<Context>,
): GoToSettingsTabActions<Context> {
  return {
    account: () =>
      step('Go to "account" settings tab', (page) =>
        page
          .getByRole('button', { name: TEXT.accountSettingsTab })
          .getByText(TEXT.accountSettingsTab)
          .click(),
      ).into(SettingsAccountTabActions<Context>),
    local: () =>
      step('Go to "local" settings tab', (page) =>
        page
          .getByRole('button', { name: TEXT.localSettingsTab })
          .getByText(TEXT.localSettingsTab)
          .click(),
      ).into(SettingsLocalTabActions<Context>),
    keyboardShortcuts: () =>
      step('Go to "keyboard shortcuts" settings tab', (page) =>
        page
          .getByRole('button', { name: TEXT.keyboardShortcutsSettingsTab })
          .getByText(TEXT.keyboardShortcutsSettingsTab)
          .click(),
      ).into(SettingsKeyboardShortcutsTabActions<Context>),
  }
}
