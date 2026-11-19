import type EditorPageActions from 'integration-test/actions/EditorPageActions'
import { expect, test, type Locator, type Page } from 'integration-test/base'
import { restoreMockMainFile, setMockMainFile } from 'integration-test/mock/lsHandler'
import { mockMethodCallInfo } from './expressionUpdates'

/**
 * Nodes stay one line high however deep their widgets nest, and an operator chain is one flat row
 * with a capsule where the precedence changes (spec:
 * `docs/superpowers/specs/2026-11-19-single-line-nodes-and-operator-chains-design.md`).
 */
test.describe('Single-line nodes and operator chains', () => {
  test.afterEach(restoreMockMainFile)
  test.use({
    setupApi: {
      local: () =>
        setMockMainFile(
          [
            'from Standard.Base import Data',
            '',
            'main =',
            '    latitude = 51.5',
            '    longitude = 0.12',
            "    url = '?latitude=' + latitude.to_text + '&longitude=' + longitude.to_text",
            '    total = 2 * 3 + 4 * (5 - 1)',
            "    nested = Data.read (Data.read_many 'a.csv')",
            '',
          ].join('\n'),
        ),
    },
  })

  const READ = {
    module: 'Standard.Base.Data',
    definedOnType: 'Standard.Base.Data',
    name: 'read',
  }
  const READ_MANY = { ...READ, name: 'read_many' }

  async function height(locator: Locator) {
    return (await locator.boundingBox())!.height
  }

  async function nodes(editorPage: EditorPageActions, page: Page) {
    await mockMethodCallInfo(page, 'nested', {
      methodPointer: READ,
      notAppliedArguments: [1, 2],
    })
    await mockMethodCallInfo(
      page,
      { binding: 'nested', expr: "Data.read_many 'a.csv'" },
      { methodPointer: READ_MANY, notAppliedArguments: [1, 2, 3] },
    )
    const plain = editorPage.locateNodes('latitude')
    const url = editorPage.locateNodes('url')
    const total = editorPage.locateNodes('total')
    const nested = editorPage.locateNodes('nested')
    await expect(nested.locator('.nestedCall')).toHaveCount(1)
    return { plain, url, total, nested }
  }

  test('every node is as high as a plain one', async ({ editorPage, page }) => {
    const { plain, url, total, nested } = await nodes(editorPage, page)
    const plainHeight = await height(plain.locator('.content'))
    for (const node of [url, total, nested]) {
      expect(await height(node.locator('.content'))).toBeCloseTo(plainHeight, 0)
    }
    for (const group of await nested.locator('.nestedCall').all()) {
      expect(await height(group)).toBeCloseTo(24, 0)
    }
    for (const capsule of await total.locator('.operatorCapsule').all()) {
      expect(await height(capsule)).toBeCloseTo(24, 0)
    }
  })

  test('a same-precedence chain is one flat row with no names', async ({ editorPage, page }) => {
    const { url } = await nodes(editorPage, page)
    await expect(url).toContainText('latitude')
    await expect(url.locator('.nestedCall')).toHaveCount(0)
    await expect(url.locator('.operatorCapsule')).toHaveCount(0)
    await expect(url.locator('.WidgetArgumentName')).toHaveCount(0)
  })

  test('a change of precedence is a capsule, without parentheses', async ({ editorPage, page }) => {
    const { total } = await nodes(editorPage, page)
    // `2 * 3`, `4 * (5 - 1)` and `5 - 1`.
    await expect(total.locator('.operatorCapsule')).toHaveCount(3)
    await expect(total.getByText('(', { exact: true })).toHaveCount(0)
    await expect(total.getByText(')', { exact: true })).toHaveCount(0)
    await expect(total.getByText('*', { exact: true })).toHaveCount(2)
  })
})
