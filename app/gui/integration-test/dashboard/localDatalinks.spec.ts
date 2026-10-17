/**
 * @file Local datalinks: creating one from the toolbar and the context menu, opening and saving it,
 * and the plain-value rule for secret fields.
 */
import { Path } from 'enso-common/src/services/Backend'
import { expect, test, type Page } from 'integration-test/base'
import { TEXT } from '../actions'

const S3 = {
  type: 'S3',
  libraryName: 'Standard.AWS',
  uri: 's3://bucket/old',
  auth: { type: 'aws_auth', subType: 'default' },
}
const EXISTING = 'Warehouse'

test.use({
  setupApi: {
    local: (localApi) => {
      localApi.addDatalink({ path: Path(`${localApi.rootPath}/${EXISTING}.datalink`), value: S3 })
    },
  },
})

const rows = (page: Page) =>
  page.getByTestId('drive-view').getByRole('grid').getByTestId('asset-row')
const row = (page: Page, name: string) => rows(page).filter({ hasText: name })
const dialog = (page: Page, title: string) => page.getByRole('dialog').filter({ hasText: title })
const uriInput = (page: Page, title: string) =>
  dialog(page, title).getByPlaceholder(TEXT.enterText).first()

test('create a datalink from the toolbar', async ({ drivePage, localApi }) => {
  await drivePage.goToCategory.local().do(async (page) => {
    await expect(row(page, EXISTING)).toBeVisible()
    await page.getByRole('button', { name: TEXT.newDatalink }).click()
    const created = dialog(page, TEXT.createDatalink)
    await created.getByPlaceholder(TEXT.datalinkNamePlaceholder).fill('Sales')
    await uriInput(page, TEXT.createDatalink).fill('s3://bucket/sales.csv')
    await created.getByRole('button', { name: TEXT.create }).click()
    await expect(created).toBeHidden()
    await expect(row(page, 'Sales')).toBeVisible()
    expect(localApi.datalinkValue(`${localApi.rootPath}/Sales.datalink`)).toMatchObject({
      type: 'S3',
      uri: 's3://bucket/sales.csv',
    })
  })
})

test('create a datalink from the context menu', async ({ drivePage, localApi }) => {
  await drivePage.goToCategory
    .local()
    // The directory's own menu: right-click the drive view below the rows (a datalink's row menu
    // has no "New …" entries, as for any non-folder asset).
    .withDriveView(async (view) => {
      const box = (await view.boundingBox())!
      await view.click({ button: 'right', position: { x: 20, y: box.height - 20 } })
    })
    .contextMenu.newDataLink()
    .do(async (page) => {
      await dialog(page, TEXT.createDatalink)
        .getByPlaceholder(TEXT.datalinkNamePlaceholder)
        .fill('Menu')
      await uriInput(page, TEXT.createDatalink).fill('s3://bucket/menu.csv')
      await dialog(page, TEXT.createDatalink).getByRole('button', { name: TEXT.create }).click()
      await expect(row(page, 'Menu')).toBeVisible()
      expect(localApi.datalinkValue(`${localApi.rootPath}/Menu.datalink`)).toBeDefined()
    })
})

test('open a datalink, edit it and save it', async ({ drivePage, localApi }) => {
  await drivePage.goToCategory.local().do(async (page) => {
    await row(page, EXISTING).getByText(EXISTING).dblclick()
    const edited = dialog(page, TEXT.editDatalink)
    await expect(edited.getByPlaceholder(TEXT.datalinkNamePlaceholder)).toHaveValue(EXISTING)
    await expect(uriInput(page, TEXT.editDatalink)).toHaveValue('s3://bucket/old')
    await uriInput(page, TEXT.editDatalink).fill('s3://bucket/new')
    await edited.getByRole('button', { name: TEXT.save }).click()
    await expect(edited).toBeHidden()
    await expect
      .poll(() => localApi.datalinkValue(`${localApi.rootPath}/${EXISTING}.datalink`))
      .toMatchObject({ uri: 's3://bucket/new' })
  })
})

test('secret fields take plain values only', async ({ drivePage }) => {
  await drivePage.goToCategory.local().do(async (page) => {
    await page.getByRole('button', { name: TEXT.newDatalink }).click()
    const created = dialog(page, TEXT.createDatalink)
    // A collapsed dropdown clips its options, so pointer hit-testing fails; dispatch the click.
    await created
      .getByRole('option', { name: 'Postgres Database Connection' })
      .dispatchEvent('click')
    await expect(created.getByRole('option', { name: 'Enso Secret' })).toHaveCount(0)
    await expect(created.getByText(TEXT.datalinkSecretsUnavailable).first()).toBeVisible()
    await expect(created.getByRole('option', { name: 'Enso File' })).toHaveCount(0)
  })
})
