import AxeBuilder from '@axe-core/playwright'
import { expect, test } from 'playwright/test'
import { FUNCTION_PAGE, GUIDE_PAGE, TYPE_PAGE } from './pages'

for (const colorScheme of ['light', 'dark'] as const) {
  for (const [name, path] of [
    ['function', FUNCTION_PAGE],
    ['type', TYPE_PAGE],
    ['guide', GUIDE_PAGE],
  ] as const) {
    test(`${name} page has no axe violations (${colorScheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme })
      await page.goto(path)
      await expect(page.locator('h1')).toBeVisible()
      const results = await new AxeBuilder({ page }).analyze()
      expect(results.violations).toEqual([])
    })
  }
}
