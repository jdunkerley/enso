/** @file Actions for going to a different page. */
import type { PageCallback } from './BaseActions'
import BaseActions from './BaseActions'
import DrivePageActions from './DrivePageActions'
import EditorPageActions from './EditorPageActions'
import SettingsPageActions from './SettingsPageActions'

/** Actions for going to a different page. */
export interface GoToPageActions<Context> {
  readonly drive: () => DrivePageActions<Context>
  readonly projectView: () => EditorPageActions<Context>
  readonly settings: () => SettingsPageActions<Context>
}

/** Generate actions for going to a different page. */
export function goToPageActions<Context>(
  step: (
    name: string,
    callback: PageCallback<Context, BaseActions<Context>>,
  ) => BaseActions<Context>,
): GoToPageActions<Context> {
  return {
    drive: () =>
      step('Go to Drive', async (page) => {
        // Drive is not a separate tab, we focus left panel instead.
        await page.locator('.leftBar').click()
        // The click leaves the cursor resting on the leftBar, which expands over the drive panel
        // 550ms after the pointer enters it. Playwright only moves the mouse once the target is
        // uncovered, so a later click on the toolbar or a row's leftmost button then waits out its
        // whole timeout under a bar that never collapses. Leaving the bar cancels the expansion,
        // as a user's pointer heading for those buttons would.
        await page.mouse.move(0, 0)
      }).into(DrivePageActions<Context>),
    projectView: () =>
      step('Go to Project page', (page) =>
        page.getByTestId('project-view-tab-button').click(),
      ).into(EditorPageActions<Context>),
    settings: () =>
      step('Go to "settings" page', (page) => BaseActions.press(page, 'Mod+,')).into(
        SettingsPageActions<Context>,
      ),
  }
}
