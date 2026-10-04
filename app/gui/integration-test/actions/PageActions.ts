/** @file Actions common to all pages. */
import { expect, type Page } from 'integration-test/base'
import BaseActions, { type BaseActionsClass, type LocatorCallback } from './BaseActions'
import { openUserMenuAction } from './openUserMenuAction'
import { userMenuActions } from './userMenuActions'

/** Find right panel. */
function locateRightPanel(page: Page) {
  // This has no identifying features.
  return page.getByTestId('right-panel').locator('visible=true')
}

/** Wait until the Right Panel has finished opening or closing. */
async function expectRightPanelSettled(page: Page) {
  // `SizeTransition` marks the element it is animating with `data-transitioning`, synchronously
  // within the click's own task, so this cannot pass before the animation has started.
  await expect(page.getByTestId('right-panel').locator('[data-transitioning]')).toHaveCount(0)
}

/** Actions common to all pages. */
export default class PageActions<
  Context,
  ParentClass extends BaseActionsClass<Context> = never,
> extends BaseActions<Context, ParentClass> {
  /** Actions related to the User Menu. */
  get userMenu() {
    return userMenuActions(this.step.bind(this))
  }

  /** Open the User Menu. */
  openUserMenu() {
    return openUserMenuAction(this.step.bind(this))
  }

  /** Show the properties tab of the Right Panel. */
  togglePropertiesAssetPanel() {
    return this.step('Toggle properties asset panel', async (page) => {
      await page.getByRole('tab', { name: 'Properties' }).click()
    })
  }

  /** Show the description tab of the Right Panel. */
  toggleDescriptionAssetPanel() {
    return this.step('Toggle description asset panel', async (page) => {
      await page.getByRole('tab', { name: 'Description' }).click()
    })
  }

  /** Expect Documentation Panel to be visible. */
  expectDocsPanel() {
    return this.step('Docs panel is opened', async (page) => {
      await expect(page.locator('.DocumentationEditor')).toBeVisible()
    })
  }

  /**
   * Show the Docs tab of the Right Panel, or hide the panel if it is already showing it.
   *
   * Waits for the panel's open or close animation to finish. The animation resizes the graph
   * editor's viewport for about 250 ms, and while it runs the SVG layer holding the edges and the
   * output ports' hover areas lags the nodes by a frame, so a node's output port can briefly sit
   * over empty background. A press that lands there starts dragging an edge instead of whatever
   * the test meant to do.
   */
  toggleDocsAssetPanel() {
    return this.step('Toggle docs asset panel', async (page) => {
      await page.getByRole('tab', { name: 'Documentation' }).click()
      await expectRightPanelSettled(page)
    })
  }

  /** Interact with the Right Panel. */
  withRightPanel(callback: LocatorCallback<Context>) {
    return this.step('Interact with right panel', async (page, context) => {
      await callback(locateRightPanel(page), context)
    })
  }
}
