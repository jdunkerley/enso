/**
 * @file The Reka UI spike (#76): a Vue `DropdownMenu` built on Reka's `DropdownMenu`, mounted in the app
 * container beside the user bar, keeps its keyboard and focus behaviour while the page's other
 * overlays and global listeners are live.
 *
 * Remove together with `HeadlessUiSpike.vue` once the `DropdownMenu` primitive has a real mount site.
 */
import { expect, test, type Page } from 'integration-test/base'

import { TEXT } from '../actions'

test.use({ featureFlags: { enableHeadlessUiSpike: true } })

const trigger = (page: Page) => page.getByTestId('headless-ui-spike-trigger')
const menu = (page: Page) => page.getByTestId('headless-ui-spike-menu')
const item = (page: Page, name: string) => page.getByTestId(`headless-ui-spike-item-${name}`)
const selection = (page: Page) => page.getByTestId('headless-ui-spike-selection')

test('keyboard: open, navigate past the disabled item, wrap and select', async ({ drivePage }) => {
  await drivePage.do(async (page) => {
    await trigger(page).focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('menu')).toBeVisible()
    await expect(item(page, 'alpha')).toBeFocused()
    await expect(trigger(page)).toHaveAttribute('aria-expanded', 'true')

    await page.keyboard.press('ArrowDown')
    await expect(item(page, 'beta')).toBeFocused()
    // "Unavailable" is disabled, so the next stop is past the separator.
    await page.keyboard.press('ArrowDown')
    await expect(item(page, 'gamma')).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await expect(item(page, 'alpha')).toBeFocused()
    await page.keyboard.press('ArrowUp')
    await expect(item(page, 'gamma')).toBeFocused()

    await page.keyboard.press('Enter')
    await expect(menu(page)).toHaveCount(0)
    await expect(selection(page)).toHaveText('Gamma')
    await expect(trigger(page)).toBeFocused()
  })
})

test('Escape closes the menu and returns focus to the trigger', async ({ drivePage }) => {
  await drivePage.do(async (page) => {
    await trigger(page).click()
    await expect(menu(page)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(menu(page)).toHaveCount(0)
    await expect(trigger(page)).toBeFocused()
    await expect(trigger(page)).toHaveAttribute('aria-expanded', 'false')
    await expect(selection(page)).toHaveText('')
  })
})

test('pointer selection, and the disabled item does nothing', async ({ drivePage }) => {
  await drivePage.do(async (page) => {
    await trigger(page).click()
    await item(page, 'disabled').click({ force: true })
    await expect(menu(page)).toBeVisible()
    await expect(selection(page)).toHaveText('')
    await item(page, 'beta').click()
    await expect(menu(page)).toHaveCount(0)
    await expect(selection(page)).toHaveText('Beta')
  })
})

test('coexists with the user menu', async ({ drivePage }) => {
  await drivePage.do(async (page) => {
    // Reka's menu is modal by default (its underlay swallows the dismissing click): the first
    // outside click only closes it; the next reaches the user bar.
    await trigger(page).click()
    await expect(menu(page)).toBeVisible()
    const userMenuButton = page.getByLabel(TEXT.userMenuLabel).locator('visible=true')
    await page.mouse.click(1, 1)
    await expect(menu(page)).toHaveCount(0)
    await userMenuButton.click()
    await expect(page.getByTestId('user-menu')).toBeVisible()
    // The same holds the other way round: the modal user menu takes the click meant for the
    // spike's trigger (`click()` would wait for it to clear, so click by position instead).
    const box = await trigger(page).boundingBox()
    expect(box).not.toBeNull()
    await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2)
    await expect(page.getByTestId('user-menu')).toHaveCount(0)
    await expect(menu(page)).toHaveCount(0)

    // And back: the spike's menu still takes focus and keyboard input after the user menu has run
    // its focus scope on the same page.
    await trigger(page).focus()
    await page.keyboard.press('ArrowDown')
    await expect(menu(page)).toBeVisible()
    await expect(item(page, 'alpha')).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(menu(page)).toHaveCount(0)
  })
})

test('styled by the shared variants, rendered in the React portal root', async ({ drivePage }) => {
  await drivePage.do(async (page) => {
    await trigger(page).click()
    await expect(
      page.locator('#enso-portal-root').getByTestId('headless-ui-spike-menu'),
    ).toBeVisible()
    // `DIALOG_BACKGROUND` (`backdrop-blur-md`, `bg-background/75`) from `Dialog/variants.ts`.
    await expect(menu(page)).toHaveCSS('backdrop-filter', /blur/)
    await expect(menu(page)).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    // The highlight follows the pointer via Reka's `data-highlighted`.
    await item(page, 'beta').hover()
    await expect(item(page, 'beta')).toHaveAttribute('data-highlighted', '')
    await expect(item(page, 'beta')).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    await expect(item(page, 'alpha')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  })
})
