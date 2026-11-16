// The scatter plot's data format's field names are snake_case (`is_multi_series`, …).
/* eslint-disable camelcase */

import type EditorPageActions from 'integration-test/actions/EditorPageActions'
import { expect, test, type Page } from 'integration-test/base'
import type { MockLocalApi } from 'integration-test/mock/localApi'
import * as actions from './actions'
import * as locate from './locate'

/** The action of a point's row, as `Scatter_Plot.process_to_json_text` sends it for a table. */
const TABLE_ROW_ACTION = {
  id: 'open_row',
  label: 'Get Row',
  icon: 'select_row',
  kind: 'chain',
  template: 'get_row {{#index}}',
}

/** The action of the brush, which only a table offers. */
const BRUSH_ACTION = {
  id: 'brush_filter',
  label: 'Filter To Selection',
  icon: '',
  kind: 'chain',
  template: 'filter {{@column}} (..Between {{#min}} {{#max}})',
}

/** What `Scatter_Plot.process_to_json_text` sends for a table with columns `x` and `y`. */
const SCATTER_DATA = {
  data: [
    { x: 0, y: 3, row_number: 0 },
    { x: 1, y: 1, row_number: 1 },
    { x: 2, y: 2, row_number: 2 },
  ],
  axis: { x: { label: 'x' }, y: { label: 'y' } },
  is_multi_series: false,
  get_row_method: 'get_row',
  x_value_type: 'Integer',
  error_message: null,
  actions: [TABLE_ROW_ACTION, BRUSH_ACTION],
}

/** What it sends for a vector of the same values: a point is an item, and there is no brush. */
const VECTOR_DATA = {
  ...SCATTER_DATA,
  axis: null,
  get_row_method: 'at',
  actions: [
    {
      id: 'open_row',
      label: 'Get Item',
      icon: 'select_row',
      kind: 'chain',
      template: 'at {{#index}}',
    },
  ],
}

/** Shows `data` in the scatter plot of the `aggregated` node, in fullscreen. */
async function showScatterplot(
  page: Page,
  editorPage: EditorPageActions,
  localApi: MockLocalApi,
  data: object,
) {
  await editorPage.mockExpressionUpdate('aggregated', { type: ['Standard.Table.Table.Table'] })
  await actions.openVisualization(page, 'Scatter Plot')
  await expect(locate.scatterplotVisualization(page)).toExist()
  await localApi.updateVisualization(
    'Standard.Visualization.Scatter_Plot.process_to_json_text',
    data,
  )
  // Fullscreen gives the plot room: in the node it is too small for the toolbar to clear its resize handle.
  await locate.enterFullscreenButton(locate.graphNodeByBinding(page, 'aggregated')).click()
  await expect(locate.exitFullscreenButton(page)).toExist()
}

/** Scenario: a brushed rectangle of the scatter plot becomes `filter` components on the axes. */
test('A brushed selection makes a filter node', async ({ editorPage, page, localApi }) => {
  await showScatterplot(page, editorPage, localApi, SCATTER_DATA)
  await page.getByRole('button', { name: 'Enable Selection' }).click()
  const box = (await locate.scatterplotVisualization(page).boundingBox())!
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.8, { steps: 5 })
  await page.mouse.up()
  const nodeCount = await locate.graphNode(page).count()
  await page.getByRole('button', { name: 'Create component of selected points' }).click()
  await expect(locate.graphNode(page)).toHaveCount(nodeCount + 1)
  await expect(locate.graphNode(page).last()).toContainText(
    /filter.*x.*Between.*filter.*y.*Between/,
  )
})

/** Scenario: a double-clicked point becomes the component of its row. */
test('A double-clicked point makes its row node', async ({ editorPage, page, localApi }) => {
  await showScatterplot(page, editorPage, localApi, SCATTER_DATA)
  const nodeCount = await locate.graphNode(page).count()
  await page.locator('.scatterPoint').nth(1).dblclick()
  await expect(locate.graphNode(page)).toHaveCount(nodeCount + 1)
  const node = locate.graphNode(page).last()
  await expect(node).toContainText('get_row')
  await expect(node.getByRole('textbox')).toHaveValue('1')
})

/** Scenario: a vector's point is an item (`at`), and only a table can be filtered by a brush. */
test('A vector offers its item but not the brush', async ({ editorPage, page, localApi }) => {
  await showScatterplot(page, editorPage, localApi, VECTOR_DATA)
  await expect(page.getByRole('button', { name: 'Enable Selection' })).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Create component of selected points' }),
  ).toHaveCount(0)
  const nodeCount = await locate.graphNode(page).count()
  await page.locator('.scatterPoint').nth(1).dblclick()
  await expect(locate.graphNode(page)).toHaveCount(nodeCount + 1)
  const node = locate.graphNode(page).last()
  await expect(node).toContainText(/node1\s*at/)
  await expect(node.getByRole('textbox')).toHaveValue('1')
})
