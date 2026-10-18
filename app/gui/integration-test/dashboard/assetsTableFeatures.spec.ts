/** @file Test the drive view. */
import { expect, test, type Page } from 'integration-test/base'

/** Find an extra columns button panel. */
function locateExtraColumns(page: Page) {
  // This has no identifying features.
  return page.getByTestId('extra-columns')
}

const PASS_TIMEOUT = 5_000
test.describe(() => {
  test.use({
    setupApi: {
      addDefaultProject: false,
      local: (localApi) => {
        for (let i = 0; i < 100; i += 1) {
          localApi.addRootFile('a ' + i)
        }
      },
    },
  })
  test('extra columns should stick to top of scroll container', async ({ drivePage }) => {
    await drivePage.goToCategory
      .local()
      .driveTable.toggleColumn.labels()
      .withAssetsTable(async (assetsTable) => {
        await assetsTable.evaluate((element) => {
          let scrollableParent: HTMLElement | SVGElement | null = element
          while (
            scrollableParent != null &&
            scrollableParent.scrollHeight <= scrollableParent.clientHeight
          ) {
            scrollableParent = scrollableParent.parentElement
          }
          scrollableParent?.scrollTo({ top: 999999, behavior: 'instant' })
        })
      })
      .withAssetsTable(async (assetsTable, _, page) => {
        const extraColumns = locateExtraColumns(page)
        await expect(async () => {
          const extraColumnsTop = await extraColumns.evaluate(
            (element) => element.getBoundingClientRect().top,
          )
          const assetsTableTop = await assetsTable.evaluate((element) => {
            let scrollableParent: HTMLElement | SVGElement | null = element
            while (
              scrollableParent != null &&
              scrollableParent.scrollHeight <= scrollableParent.clientHeight
            ) {
              scrollableParent = scrollableParent.parentElement
            }
            return scrollableParent?.getBoundingClientRect().top ?? 0
          })
          expect(extraColumnsTop).toEqual(assetsTableTop + 2)
        }).toPass({ timeout: PASS_TIMEOUT })
      })
  })
})
