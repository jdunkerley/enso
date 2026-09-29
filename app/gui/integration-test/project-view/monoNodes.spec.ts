/**
 * @file The `monoNodes` feature flag (#112): node text and component browser entries use
 * `--font-code`, which is Monaspace Neon with the flag on (the default) and M PLUS 1 with it off
 * (the kill switch, kept for one release).
 */
import { expect, test, type Page } from 'integration-test/base'
import * as locate from './locate'

async function expectNodeTextFont(page: Page, family: RegExp) {
  const node = locate.graphNodeByBinding(page, 'final')
  await expect(node.locator('.content')).toHaveCSS('font-family', family)
  await expect(node.locator('.binding')).toHaveCSS('font-family', family)

  await locate.addNewNodeButton(page).click()
  await expect(locate.componentBrowser(page)).toExist()
  await expect(locate.componentBrowserEntry(page).first()).toHaveCSS('font-family', family)
}

test('Node text uses Monaspace Neon by default', async ({ editorPage, page }) => {
  await editorPage
  await expectNodeTextFont(page, /^"Monaspace Neon"/)
})

test.describe('monoNodes off', () => {
  test.use({ featureFlags: { monoNodes: false } })

  test('Node text uses M PLUS 1', async ({ editorPage, page }) => {
    await editorPage
    await expectNodeTextFont(page, /^"M PLUS 1"/)
  })
})
