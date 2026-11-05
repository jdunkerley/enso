import { expect, test, type Page } from 'playwright/test'
import { FUNCTION_PAGE } from './pages'

/**
 * Opens the function page and waits for React to hydrate the node: a tooltip gets `data-open` only
 * then. Before it the tooltips follow CSS `:focus`/`:hover` alone, and a key pressed in that window
 * (a slow CI runner) reaches no handler.
 */
async function openFunctionPage(page: Page) {
  await page.goto(FUNCTION_PAGE)
  await page.locator('[role=tooltip][data-open]').first().waitFor({ state: 'attached' })
}

test.describe('component node tooltips', () => {
  test('Tab reaches each pill, focus shows its tooltip, Escape hides it', async ({ page }) => {
    await openFunctionPage(page)
    const node = page.locator('[role=group][aria-label]').first()
    const pills = node.getByRole('button')
    const count = await pills.count()
    expect(count).toBeGreaterThan(1)
    await pills.first().focus()
    for (let i = 0; i < count; i++) {
      const pill = pills.nth(i)
      await expect(pill).toBeFocused()
      const tooltip = page.locator(`#${await pill.getAttribute('aria-describedby')}`)
      await expect(tooltip).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(tooltip).toBeHidden()
      await page.keyboard.press('Tab')
    }
  })

  test('hover shows a tooltip, and it stays while the pointer is over it', async ({ page }) => {
    await openFunctionPage(page)
    const name = page.locator('[role=group][aria-label]').first().getByRole('button').first()
    const tooltip = page.locator(`#${await name.getAttribute('aria-describedby')}`)
    await name.hover()
    await expect(tooltip).toBeVisible()
    await tooltip.hover()
    await expect(tooltip).toBeVisible()
    await page.mouse.move(0, 0)
    await expect(tooltip).toBeHidden()
  })

  test('Enter toggles the tooltip of a focused pill closed and open again', async ({ page }) => {
    await openFunctionPage(page)
    const name = page.locator('[role=group][aria-label]').first().getByRole('button').first()
    const tooltip = page.locator(`#${await name.getAttribute('aria-describedby')}`)
    await name.focus()
    await expect(tooltip).toBeVisible()
    await page.keyboard.press('Enter')
    await expect(tooltip).toBeHidden()
    await page.keyboard.press('Enter')
    await expect(tooltip).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(tooltip).toBeHidden()
  })

  test('the node has the full signature as its accessible name', async ({ page }) => {
    await openFunctionPage(page)
    await expect(page.locator('[role=group][aria-label]').first()).toHaveAttribute(
      'aria-label',
      /\) -> /,
    )
  })
})

test('at phone width the node and an open tooltip fit the screen @touch', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 })
  await openFunctionPage(page)
  const pills = page.locator('[role=group][aria-label]').first().getByRole('button')
  const fits = () =>
    page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    )
  expect(await fits()).toBe(true)
  for (let i = 0; i < (await pills.count()); i++) {
    const pill = pills.nth(i)
    const tooltip = page.locator(`#${await pill.getAttribute('aria-describedby')}`)
    await pill.tap()
    await expect(tooltip).toBeVisible()
    expect(await fits()).toBe(true)
    await page.locator('h1').tap()
  }
})

test('a tap toggles a tooltip; tapping elsewhere closes it @touch', async ({ page }) => {
  await openFunctionPage(page)
  const name = page.locator('[role=group][aria-label]').first().getByRole('button').first()
  const tooltip = page.locator(`#${await name.getAttribute('aria-describedby')}`)
  await name.tap()
  await expect(tooltip).toBeVisible()
  await name.tap()
  await expect(tooltip).toBeHidden()
  await name.tap()
  await expect(tooltip).toBeVisible()
  await page.locator('h1').tap()
  await expect(tooltip).toBeHidden()
})

test('the breadcrumbs read Library › Module › Type › function', async ({ page }) => {
  await openFunctionPage(page)
  const crumbs = page.locator('nav[aria-label="Breadcrumbs"] li')
  // Home, then library, module, type and the function itself.
  await expect(crumbs).toHaveCount(5)
  await expect(crumbs.nth(1)).toHaveText(/^Standard\./)
})
