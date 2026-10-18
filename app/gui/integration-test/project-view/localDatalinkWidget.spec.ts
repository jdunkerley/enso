/**
 * @file The file widget picks a `.datalink` file. The native dialog cannot be driven, so its stand-in
 * (`window.api.fileBrowser`, mocked in `mock/registerMocks.ts`) records its filters and returns a
 * datalink.
 */
import { expect, test } from 'integration-test/base'
import { mockMethodCallInfo } from './expressionUpdates'
import * as locate from './locate'

const LINK = '/home/user/enso/enso-projects/Sales.datalink'

test('the file widget sets a chosen .datalink path', async ({ editorPage, page }) => {
  await editorPage
  await page.evaluate((link) => {
    const calls: unknown[][] = []
    Object.assign(window, { __fileBrowserCalls: calls })
    Object.assign(window.api!.fileBrowser, {
      openFileBrowser: async (...args: unknown[]) => {
        calls.push(args)
        return [link]
      },
    })
  }, LINK)
  await mockMethodCallInfo(page, 'data', {
    methodPointer: {
      module: 'Standard.Base.Data',
      definedOnType: 'Standard.Base.Data',
      name: 'read',
    },
    notAppliedArguments: [0, 1, 2],
  })
  const pathArg = locate
    .graphNodeByBinding(page, 'data')
    .locator('.WidgetTopLevelArgument')
    .filter({ hasText: 'path' })
  await pathArg.click()
  await page.getByText('Choose file…').click()
  await expect(pathArg.getByTestId('widget-text-content')).toHaveText(LINK)
  const calls = await page.evaluate(
    () => (window as unknown as { __fileBrowserCalls: unknown[][] }).__fileBrowserCalls,
  )
  expect(calls).toHaveLength(1)
  // `Data.read`'s path has no file types here, so the dialog lists every file, datalinks included.
  expect(calls[0]![2]).toBeUndefined()
})
