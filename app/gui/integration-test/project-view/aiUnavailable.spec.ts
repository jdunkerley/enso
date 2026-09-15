import { expect, test } from 'integration-test/base'
import * as locate from './locate'

// The `aiAvailable` fixture defaults to `false`, so the AI mode entry renders disabled.

test('the disabled AI mode entry explains how to enable it', async ({ editorPage, page }) => {
  await editorPage

  const sourceNode = locate.graphNodeByBinding(page, 'data')
  await sourceNode.click()
  await expect(sourceNode).toBeSelected()
  await locate.graphEditor(page).press('Enter')
  await expect(locate.componentBrowser(page)).toBeVisible()

  await page.locator('.ModeMenu .MenuButton').first().click()
  const aiOption = page.locator('.modeOption').filter({ hasText: 'AI prompt' })
  await expect(aiOption).toBeDisabled()

  // A disabled button still receives `pointerenter`, which is what surfaces the tooltip telling
  // the user how to enable AI mode. Suppressing pointer events on it would silently lose that.
  await aiOption.hover()
  await expect(page.locator('.Tooltip').filter({ hasText: 'Claude Code' })).toBeVisible({
    timeout: 8000,
  })
})
