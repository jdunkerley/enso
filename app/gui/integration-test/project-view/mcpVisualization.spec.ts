/* eslint-disable camelcase -- tool argument names are snake_case on the wire */
/**
 * @file The window's two `get_visualization` handlers driving the real graph editor: a call is
 * delivered as Electron main would (`window.__mcpCall`, `mock/registerMocks.ts`), and the spec
 * checks the visualization, the view and the undo stack. The mock answers a visualization's
 * preprocessor by itself (`mockVizPreprocessors` in `mock/lsHandler.ts`), so a shown
 * visualization gets data without help.
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
