/* eslint-disable camelcase -- tool argument names are snake_case on the wire */
/**
 * @file The window's two `get_visualization` handlers, and `list_visualizations`, driving the
 * real graph editor: a call is delivered as Electron main would (`window.__mcpCall`,
 * `mock/registerMocks.ts`), and the spec checks the visualization, the view and the undo stack.
 * The mock answers a visualization's preprocessor by itself (`mockVizPreprocessors` in
 * `mock/lsHandler.ts`), so a shown visualization gets data without help.
 */
import assert from 'assert'
import { expect, test, type Page } from 'integration-test/base'
import { mockExecutionEnvironment, setMockExecutionMode } from 'integration-test/mock/lsHandler'
import * as locate from './locate'

// Each test opens the project and shows a visualization through the edit session.
test.setTimeout(60_000)

interface ToolResult {
  ok: boolean
  value?: string
  error?: string
}

/** Delivers the tool call as Electron main would, and resolves with its result. */
function deliver(page: Page, tool: string, args: object): Promise<ToolResult> {
  return page.evaluate(
    ([tool, args]) =>
      (
        window as unknown as {
          __mcpCall: (tool: string, args: unknown) => Promise<ToolResult>
        }
      ).__mcpCall(tool as string, args),
    [tool, args] as const,
  )
}

/** The call's value, parsed; fails the test on an error. */
async function callOk(page: Page, tool: string, args: object) {
  const result = await deliver(page, tool, args)
  assert(result.ok, `${tool} failed: ${result.error}`)
  return JSON.parse(result.value!)
}

async function nodeId(page: Page, name: string): Promise<string> {
  const graph = await callOk(page, 'get_graph', { previews: false })
  const node = (graph.nodes as { id: string; name: string | null }[]).find((n) => n.name === name)
  assert(node != null, `no node ${name}`)
  return node.id
}

function visualizationOf(page: Page, id: string) {
  return page.locator(`.GraphNode[data-node-id="${id}"]`).locator('.GraphVisualization')
}

function panelOf(page: Page, id: string) {
  return page.locator(`.GraphNode[data-node-id="${id}"]`).locator('.VisualizationPanel')
}

function viewport(page: Page) {
  return locate.graphEditor(page).locator('.viewport')
}

/** Switches the project to Live and waits until the GUI has set the execution environment. */
async function goLive() {
  setMockExecutionMode('live')
  await expect.poll(mockExecutionEnvironment).toBe('Live')
}

test('get_visualization_data shows a hidden visualization as one undo step', async ({
  editorPage,
  page,
}) => {
  await editorPage
  const final = await nodeId(page, 'final')
  await expect(visualizationOf(page, final)).toHaveCount(0)

  const result = await callOk(page, 'get_visualization_data', { node_id: final })
  expect(result).toEqual(expect.objectContaining({ node_id: final, shown: true, truncated: false }))
  expect(typeof result.visualization).toBe('string')
  expect(result.data).toBeDefined()
  await expect(visualizationOf(page, final)).toBeVisible()

  await page.keyboard.press('ControlOrMeta+Z')
  await expect(visualizationOf(page, final)).toHaveCount(0)
})

test('prepare_visualization answers with the panel rectangle', async ({ editorPage, page }) => {
  await editorPage
  const final = await nodeId(page, 'final')

  const result = await callOk(page, 'prepare_visualization', { node_id: final })
  expect(result.node_id).toBe(final)
  expect(result.shown).toBe(true)
  const box = await panelOf(page, final).boundingBox()
  assert(box != null)
  const { x, y, width, height } = result.rect
  expect(Math.abs(x - box.x)).toBeLessThanOrEqual(1)
  expect(Math.abs(y - box.y)).toBeLessThanOrEqual(1)
  expect(Math.abs(x + width - (box.x + box.width))).toBeLessThanOrEqual(1)
  expect(Math.abs(y + height - (box.y + box.height))).toBeLessThanOrEqual(1)
})

test('prepare_visualization brings a zoomed-out graph back to 100%', async ({
  editorPage,
  page,
}) => {
  await editorPage
  const final = await nodeId(page, 'final')
  await callOk(page, 'get_visualization_data', { node_id: final })
  await expect(visualizationOf(page, final)).toBeVisible()
  const panel = panelOf(page, final)
  const before = await panel.boundingBox()
  assert(before != null)

  // Zoom out: Ctrl with the mouse wheel over the graph.
  const view = await viewport(page).boundingBox()
  assert(view != null)
  await page.mouse.move(view.x + view.width / 2, view.y + view.height / 2)
  await page.keyboard.down('Control')
  for (let i = 0; i < 4; i++) await page.mouse.wheel(0, 200)
  await page.keyboard.up('Control')
  await expect.poll(async () => (await panel.boundingBox())?.width).toBeLessThan(before.width - 10)

  const result = await callOk(page, 'prepare_visualization', { node_id: final })
  expect(result.moved).toBe(true)
  const after = await panel.boundingBox()
  assert(after != null)
  expect(Math.abs(after.width - before.width)).toBeLessThanOrEqual(1)
  const viewAfter = await viewport(page).boundingBox()
  assert(viewAfter != null)
  expect(after.x).toBeGreaterThanOrEqual(viewAfter.x - 1)
  expect(after.y).toBeGreaterThanOrEqual(viewAfter.y - 1)
  expect(after.x + after.width).toBeLessThanOrEqual(viewAfter.x + viewAfter.width + 1)
  expect(after.y + after.height).toBeLessThanOrEqual(viewAfter.y + viewAfter.height + 1)
})

test('in Live mode a hidden visualization is refused; a shown one answers', async ({
  editorPage,
  page,
}) => {
  await editorPage
  const final = await nodeId(page, 'final')
  const ten = await nodeId(page, 'ten')
  await callOk(page, 'get_visualization_data', { node_id: final })
  await expect(visualizationOf(page, final)).toBeVisible()

  await goLive()

  const refused = await deliver(page, 'get_visualization_data', { node_id: ten })
  expect(refused.ok).toBe(false)
  expect(refused.error).toContain('Live mode')
  await expect(visualizationOf(page, ten)).toHaveCount(0)

  const shown = await callOk(page, 'get_visualization_data', { node_id: final })
  expect(shown.shown).toBe(false)
  expect((await callOk(page, 'prepare_visualization', { node_id: final })).shown).toBe(false)
})

test('list_visualizations names what a hidden node offers and leaves it hidden', async ({
  editorPage,
  page,
}) => {
  await editorPage
  const final = await nodeId(page, 'final')

  const listed = await callOk(page, 'list_visualizations', { node_id: final })
  expect(listed).toEqual({
    node_id: final,
    shown: false,
    visualization: null,
    available: expect.arrayContaining(['JSON', 'Table']),
    // The default size: as wide as the node or 200, and 150 high.
    size: {
      width: expect.any(Number),
      height: 150,
      default_width: true,
      default_height: true,
    },
  })
  expect(listed.size.width).toBeGreaterThanOrEqual(200)
  await expect(visualizationOf(page, final)).toHaveCount(0)
})

test('a named visualization is shown on a hidden node, as one undo step', async ({
  editorPage,
  page,
}) => {
  await editorPage
  const final = await nodeId(page, 'final')

  const result = await callOk(page, 'get_visualization_data', {
    node_id: final,
    visualization: 'JSON',
  })
  expect(result).toEqual(
    expect.objectContaining({ visualization: 'JSON', shown: true, changed: true }),
  )
  expect(result.available).toContain('JSON')
  await expect(locate.jsonVisualization(page)).toExist()

  await page.keyboard.press('ControlOrMeta+Z')
  await expect(visualizationOf(page, final)).toHaveCount(0)
})

test('another named visualization switches the panel, and one undo switches it back', async ({
  editorPage,
  page,
}) => {
  await editorPage
  const final = await nodeId(page, 'final')
  // The user shows it: an edit of their own, so the agent's switch is a step of its own.
  await locate.graphNodeByBinding(page, 'final').click({ position: { x: 8, y: 8 } })
  await locate.toggleVisualizationButton(page).click()
  await expect(locate.loadingVisualization(page)).toHaveCount(0)
  await expect(locate.jsonVisualization(page)).toExist()
  const before = await callOk(page, 'list_visualizations', { node_id: final })
  expect(before).toEqual(
    expect.objectContaining({ shown: true, visualization: 'JSON', available: expect.anything() }),
  )
  expect(before.available).toContain('Table')

  const result = await callOk(page, 'get_visualization_data', {
    node_id: final,
    visualization: 'Table',
  })
  expect(result).toEqual(
    expect.objectContaining({ visualization: 'Table', shown: false, changed: true }),
  )
  await expect(locate.tableVisualization(page)).toExist()
  await expect(locate.jsonVisualization(page)).toHaveCount(0)
  // The same name again changes nothing.
  const again = await callOk(page, 'get_visualization_data', {
    node_id: final,
    visualization: 'Table',
  })
  expect(again.changed).toBe(false)

  await page.keyboard.press('ControlOrMeta+Z')
  await expect(locate.jsonVisualization(page)).toExist()
  await expect(locate.tableVisualization(page)).toHaveCount(0)
  expect((await callOk(page, 'list_visualizations', { node_id: final })).visualization).toBe('JSON')
})

test('a name the node does not offer is refused, and nothing changes', async ({
  editorPage,
  page,
}) => {
  await editorPage
  const final = await nodeId(page, 'final')

  for (const tool of ['get_visualization_data', 'prepare_visualization']) {
    const refused = await deliver(page, tool, { node_id: final, visualization: 'No Such View' })
    expect(refused.ok).toBe(false)
    expect(refused.error).toContain('The node has no visualization `No Such View`. Available: ')
  }
  await expect(visualizationOf(page, final)).toHaveCount(0)
  expect((await callOk(page, 'list_visualizations', { node_id: final })).shown).toBe(false)
})

test('in Live mode the visualization on screen answers by name; another is refused', async ({
  editorPage,
  page,
}) => {
  await editorPage
  const final = await nodeId(page, 'final')
  await callOk(page, 'get_visualization_data', { node_id: final })
  await expect(visualizationOf(page, final)).toBeVisible()
  const onScreen = (await callOk(page, 'list_visualizations', { node_id: final })).visualization
  assert(typeof onScreen === 'string')

  await goLive()

  const listed = await callOk(page, 'list_visualizations', { node_id: final })
  expect(listed.visualization).toBe(onScreen)
  const same = await callOk(page, 'get_visualization_data', {
    node_id: final,
    visualization: onScreen,
  })
  expect(same.changed).toBe(false)
  const other = onScreen === 'JSON' ? 'Table' : 'JSON'
  const refused = await deliver(page, 'get_visualization_data', {
    node_id: final,
    visualization: other,
  })
  expect(refused.ok).toBe(false)
  expect(refused.error).toContain('Live mode')
})

/** The graph's zoom, from `get_graph`'s view: 1 is 100%. */
async function scaleOf(page: Page): Promise<number> {
  return (await callOk(page, 'get_graph', { previews: false, layout: true })).view.scale
}

/** The panel's size on screen, in scene units: its box divided by the zoom. */
async function panelSize(page: Page, id: string) {
  const box = await panelOf(page, id).boundingBox()
  assert(box != null)
  const scale = await scaleOf(page)
  return { width: box.width / scale, height: box.height / scale }
}

test('set_visualization sizes the panel, every description reports it, and null resets it', async ({
  editorPage,
  page,
}) => {
  await editorPage
  const final = await nodeId(page, 'final')

  const set = await callOk(page, 'set_visualization', {
    node_id: final,
    visible: true,
    width: 600,
    height: 400,
  })
  const large = { width: 600, height: 400, default_width: false, default_height: false }
  expect(set.size).toEqual(large)
  await expect(visualizationOf(page, final)).toBeVisible()
  await expect
    .poll(async () => Math.abs((await panelSize(page, final)).width - 600))
    .toBeLessThan(2)
  expect(Math.abs((await panelSize(page, final)).height - 400)).toBeLessThan(2)
  expect((await callOk(page, 'get_visualization_data', { node_id: final })).size).toEqual(large)
  expect((await callOk(page, 'list_visualizations', { node_id: final })).size).toEqual(large)
  expect((await callOk(page, 'prepare_visualization', { node_id: final })).size).toEqual(large)

  const reset = await callOk(page, 'set_visualization', {
    node_id: final,
    visible: true,
    width: null,
    height: null,
  })
  expect(reset.size).toEqual(
    expect.objectContaining({ height: 150, default_width: true, default_height: true }),
  )
  await expect
    .poll(async () => Math.abs((await panelSize(page, final)).height - 150))
    .toBeLessThan(2)
  expect(Math.abs((await panelSize(page, final)).width - reset.size.width)).toBeLessThan(2)
})

test('one undo after a resize restores the previous size', async ({ editorPage, page }) => {
  await editorPage
  const final = await nodeId(page, 'final')
  await callOk(page, 'set_visualization', { node_id: final, visible: true })
  await expect(visualizationOf(page, final)).toBeVisible()
  const before = await panelSize(page, final)

  // Another caller: its edit is an undo step of its own, so the undo leaves the panel shown.
  const resized = await page.evaluate(
    (node_id) =>
      (
        window as unknown as {
          __mcpCall: (tool: string, args: unknown, caller: unknown) => Promise<ToolResult>
        }
      ).__mcpCall(
        'set_visualization',
        { node_id, visible: true, width: 600, height: 400 },
        { kind: 'external', name: 'codex' },
      ),
    final,
  )
  assert(resized.ok, resized.error)
  await expect.poll(async () => Math.round((await panelSize(page, final)).height)).toBe(400)

  await locate.graphEditor(page).click({ position: { x: 10, y: 10 } })
  await page.keyboard.press('ControlOrMeta+Z')
  await expect
    .poll(async () => Math.abs((await panelSize(page, final)).height - before.height))
    .toBeLessThan(2)
  expect(Math.abs((await panelSize(page, final)).width - before.width)).toBeLessThan(2)
  await expect(visualizationOf(page, final)).toBeVisible()
})

test('in Live mode a resize is refused and the size is kept', async ({ editorPage, page }) => {
  await editorPage
  const final = await nodeId(page, 'final')
  await callOk(page, 'set_visualization', { node_id: final, visible: true })
  await expect(visualizationOf(page, final)).toBeVisible()
  const before = await panelSize(page, final)
  await goLive()
  const refused = await deliver(page, 'set_visualization', {
    node_id: final,
    visible: true,
    width: 600,
    height: 400,
  })
  expect(refused.ok).toBe(false)
  expect(refused.error).toContain('Live mode')
  const after = await panelSize(page, final)
  expect(Math.abs(after.width - before.width)).toBeLessThan(2)
  expect(Math.abs(after.height - before.height)).toBeLessThan(2)
})
