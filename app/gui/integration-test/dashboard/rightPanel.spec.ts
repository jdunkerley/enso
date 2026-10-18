/** @file Tests for the asset panel. */
import { Path } from 'enso-common/src/services/Backend'
import { expect, test, type Locator } from 'integration-test/base'
import { posix } from 'node:path'
import { TEXT } from '../actions'

/** Find the contents of the Markdown editor within the given {@link Locator}. */
function locateMarkdownContent(locator: Locator) {
  return locator.getByTestId('documentation-editor-content')
}

test('Asset Panel documentation view', async ({ drivePage, localApi }) => {
  localApi.addProjectSources(Path(posix.join(localApi.rootPath, 'Mock_Project')))
  await drivePage.goToCategory
    .local()
    .driveTable.clickRow('Mock Project')
    .toggleDocsAssetPanel()
    .withRightPanel(async (rightPanel) => {
      await expect(locateMarkdownContent(rightPanel)).toBeVisible()
      await expect(locateMarkdownContent(rightPanel)).toHaveText(/Project Goal/)
      await expect(rightPanel.getByText(TEXT.arbitraryFetchImageError)).toBeHidden()
    })
})

test('Assets Panel docs images', async ({ drivePage, localApi }) => {
  localApi.addProjectSources(Path(posix.join(localApi.rootPath, 'Mock_Project')))
  await drivePage.goToCategory
    .local()
    .driveTable.clickRow('Mock Project')
    .toggleDocsAssetPanel()
    .withRightPanel(async (assetPanel) => {
      const content = locateMarkdownContent(assetPanel)
      await expect(content).toBeVisible()

      for (const image of await content.getByRole('img').all()) {
        await expect(image).toBeVisible()
        await expect(image).toHaveJSProperty('complete', true)
      }
    })
})
