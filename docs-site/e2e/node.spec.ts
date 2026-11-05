import { expect, test } from 'playwright/test'
import { FUNCTION_PAGE } from './pages'

test.describe('component node tooltips', () => {
  test('Tab reaches each pill, focus shows its tooltip, Escape hides it', async ({ page }) => {
    await page.goto(FUNCTION_PAGE)
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
    await page.goto(FUNCTION_PAGE)
    const name = page.locator('[role=group][aria-label]').first().getByRole('button').first()
    const tooltip = page.locator(`#${await name.getAttribute('aria-describedby')}`)
    await name.hover()
    await expect(tooltip).toBeVisible()
    await tooltip.hover()
    await expect(tooltip).toBeVisible()
    await page.mouse.move(0, 0)
    await expect(tooltip).toBeHidden()
  })

  test('the node has the full signature as its accessible name', async ({ page }) => {
    await page.goto(FUNCTION_PAGE)
    await expect(page.locator('[role=group][aria-label]').first()).toHaveAttribute(
      'aria-label',
      /\) -> /,
    )
  })
})

test('a tap toggles a tooltip; tapping elsewhere closes it @touch', async ({ page }) => {
  await page.goto(FUNCTION_PAGE)
  const name = page.locator('[role=group][aria-label]').first().getByRole('button').first()
  const tooltip = page.locator(`#${await name.getAttribute('aria-describedby')}`)
  await name.tap()
  await expect(tooltip).toBeVisible()
  await page.locator('h1').tap()
  await expect(tooltip).toBeHidden()
})
