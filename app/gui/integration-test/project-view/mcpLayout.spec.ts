/* eslint-disable camelcase -- tool argument names are snake_case on the wire */
/**
 * @file The MCP layout tools driving the real graph editor: `get_graph { layout: true }`,
 * `move_nodes` and `arrange_nodes`. A call is delivered as Electron main would
 * (`window.__mcpCall`, `mock/registerMocks.ts`); the spec checks the nodes on screen, the view, the
 * selection and the undo stack. A move changes nothing the engine computes, so no call waits for
 * the mock engine's results.
 */
import assert from 'assert'
import { expect, test, type Page } from 'integration-test/base'
import { mockExecutionEnvironment, setMockExecutionMode } from 'integration-test/mock/lsHandler'
import * as locate from './locate'

// Each test opens the project and edits it through the edit session.
test.setTimeout(60_000)

interface ToolResult {
  ok: boolean
  value?: string
  error?: string
}

interface Point {
  x: number
  y: number
}

interface LayoutNode {
  id: string
  name: string | null
  position?: Point
  area?: Point & { width: number; height: number }
}

interface LayoutGraph {
  nodes: LayoutNode[]
  selection: string[]
  view: Point & { width: number; height: number; scale: number }
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

function layoutGraph(page: Page): Promise<LayoutGraph> {
  return callOk(page, 'get_graph', { previews: false, layout: true })
}

function nodeNamed(graph: LayoutGraph, name: string): LayoutNode {
  const node = graph.nodes.find((n) => n.name === name)
  assert(node != null, `no node ${name}`)
  return node
}

function nodeOf(page: Page, id: string) {
  return page.locator(`.GraphNode[data-node-id="${id}"]`)
}

async function boxOf(page: Page, id: string) {
  const box = await nodeOf(page, id).boundingBox()
  assert(box != null, `node ${id} has no box`)
  return box
}

/** Switches the project to Live and waits until the GUI has set the execution environment. */
async function goLive() {
  setMockExecutionMode('live')
  await expect.poll(mockExecutionEnvironment).toBe('Live')
}

test('get_graph with layout gives positions that match the nodes on screen', async ({
  editorPage,
  page,
}) => {
  await editorPage
  const graph = await layoutGraph(page)
  expect(graph.view.width).toBeGreaterThan(0)
  expect(graph.view.height).toBeGreaterThan(0)
  expect(graph.view.scale).toBeGreaterThan(0)
  const five = nodeNamed(graph, 'five')
  const final = nodeNamed(graph, 'final')
  assert(five.position != null && final.position != null)
  expect(five.area).toBeDefined()
  expect(final.area).toBeDefined()

  // The DOM is drawn through the navigator's transform: compare offsets between two nodes, in
  // scene units, not absolute pixels.
  const fiveBox = await boxOf(page, five.id)
  const finalBox = await boxOf(page, final.id)
  const scale = graph.view.scale
  expect(
    Math.abs((finalBox.x - fiveBox.x) / scale - (final.position.x - five.position.x)),
  ).toBeLessThanOrEqual(2)
  expect(
    Math.abs((finalBox.y - fiveBox.y) / scale - (final.position.y - five.position.y)),
  ).toBeLessThanOrEqual(2)
  // The area is the room the node takes on screen.
  expect(Math.abs(five.area!.width - fiveBox.width / scale)).toBeLessThanOrEqual(2)
})

test('get_graph without layout gives no positions', async ({ editorPage, page }) => {
  await editorPage
  const graph = await callOk(page, 'get_graph', { previews: false })
  expect(graph.view).toBeUndefined()
  expect(graph.nodes[0].position).toBeUndefined()
})

test('move_nodes moves a node on screen, and one undo moves it back', async ({
  editorPage,
  page,
}) => {
  await editorPage
  const graph = await layoutGraph(page)
  const five = nodeNamed(graph, 'five')
  const ten = nodeNamed(graph, 'ten')
  assert(five.position != null)
  const before = await boxOf(page, five.id)
  const tenBefore = await boxOf(page, ten.id)
  const target = { x: five.position.x + 300, y: five.position.y + 200 }

  const result = await callOk(page, 'move_nodes', {
    moves: [{ node_id: five.id, ...target }],
  })
  expect(result).toEqual({ moved: [{ id: five.id, position: target }], settled: true })
  const scale = graph.view.scale
  await expect
    .poll(async () => (await boxOf(page, five.id)).x)
    .toBeCloseTo(before.x + 300 * scale, 0)
  expect((await boxOf(page, five.id)).y).toBeCloseTo(before.y + 200 * scale, 0)
  // The view did not move: another node is where it was.
  expect(await boxOf(page, ten.id)).toEqual(tenBefore)
  expect(nodeNamed(await layoutGraph(page), 'five').position).toEqual(target)

  await page.keyboard.press('ControlOrMeta+Z')
  await expect.poll(async () => (await boxOf(page, five.id)).x).toBeCloseTo(before.x, 0)
  expect((await boxOf(page, five.id)).y).toBeCloseTo(before.y, 0)
  expect(nodeNamed(await layoutGraph(page), 'five').position).toEqual(five.position)
})

test('move_nodes moves several nodes as one undo step', async ({ editorPage, page }) => {
  await editorPage
  const graph = await layoutGraph(page)
  const five = nodeNamed(graph, 'five')
  const ten = nodeNamed(graph, 'ten')
  assert(five.position != null && ten.position != null)
  await callOk(page, 'move_nodes', {
    moves: [
      { node_id: five.id, x: five.position.x - 400, y: five.position.y },
      { node_id: ten.id, x: ten.position.x - 400, y: ten.position.y },
    ],
  })
  const moved = await layoutGraph(page)
  expect(nodeNamed(moved, 'five').position?.x).toBe(five.position.x - 400)
  expect(nodeNamed(moved, 'ten').position?.x).toBe(ten.position.x - 400)

  await page.keyboard.press('ControlOrMeta+Z')
  await expect
    .poll(async () => nodeNamed(await layoutGraph(page), 'ten').position)
    .toEqual(ten.position)
  expect(nodeNamed(await layoutGraph(page), 'five').position).toEqual(five.position)
})

/** Delivers the call and answers how long it took, in milliseconds, measured in the window. */
function timedDeliver(page: Page, tool: string, args: object) {
  return page.evaluate(
    async ([tool, args]) => {
      const start = performance.now()
      const result = await (
        window as unknown as {
          __mcpCall: (tool: string, args: unknown) => Promise<ToolResult>
        }
      ).__mcpCall(tool as string, args)
      return { result, ms: performance.now() - start }
    },
    [tool, args] as const,
  )
}

test('a move to where the nodes already are answers without waiting for a graph update', async ({
  editorPage,
  page,
}) => {
  await editorPage
  const five = nodeNamed(await layoutGraph(page), 'five')
  assert(five.position != null)
  const target = { x: five.position.x + 300, y: five.position.y }
  const moves = [{ node_id: five.id, ...target }]
  await callOk(page, 'move_nodes', { moves })
  // The same move again changes nothing: no node-database update comes, and the edit session's
  // 2 s safety net (`GRAPH_UPDATE_WAIT_MS`) must not be waited out.
  const again = await timedDeliver(page, 'move_nodes', { moves })
  assert(again.result.ok, again.result.error)
  expect(JSON.parse(again.result.value!)).toEqual({
    moved: [{ id: five.id, position: target }],
    settled: true,
  })
  expect(again.ms).toBeLessThan(1_000)
})

test('move_nodes with an unknown node moves nothing', async ({ editorPage, page }) => {
  await editorPage
  const graph = await layoutGraph(page)
  const five = nodeNamed(graph, 'five')
  const result = await deliver(page, 'move_nodes', {
    moves: [
      { node_id: five.id, x: 0, y: 0 },
      { node_id: 'nope', x: 0, y: 0 },
    ],
  })
  expect(result.ok).toBe(false)
  expect(result.error).toContain('nope')
  expect(nodeNamed(await layoutGraph(page), 'five').position).toEqual(five.position)
})

test('in Live mode move_nodes is refused and nothing moves', async ({ editorPage, page }) => {
  await editorPage
  const graph = await layoutGraph(page)
  const five = nodeNamed(graph, 'five')
  assert(five.position != null)
  await goLive()
  const refused = await deliver(page, 'move_nodes', {
    moves: [{ node_id: five.id, x: five.position.x + 300, y: five.position.y }],
  })
  expect(refused.ok).toBe(false)
  expect(refused.error).toContain('Live mode')
  expect(nodeNamed(await layoutGraph(page), 'five').position).toEqual(five.position)
})

/** The positions of every node, by id. */
async function positions(page: Page): Promise<Map<string, Point | undefined>> {
  return new Map((await layoutGraph(page)).nodes.map((n) => [n.id, n.position]))
}

/**
 * Selects `five` by clicking it: a press ends the initial view's following of the graph, so the
 * view moves only when something moves it.
 */
async function selectFive(page: Page) {
  await locate.graphNodeByBinding(page, 'five').locator('.grab-handle').click()
  await expect(locate.selectedNodes(page)).toHaveCount(1)
}

test('arrange_nodes align_left gives scattered nodes one x, without moving the view or the selection', async ({
  editorPage,
  page,
}) => {
  await editorPage
  await selectFive(page)
  const graph = await layoutGraph(page)
  const nodes = ['five', 'ten', 'sum'].map((name) => nodeNamed(graph, name))
  const ids = nodes.map((n) => n.id)
  await callOk(page, 'move_nodes', {
    moves: nodes.map((n, i) => ({ node_id: n.id, x: -2000 + i * 150, y: -2000 + i * 200 })),
  })
  const before = await layoutGraph(page)
  const fiveBox = await boxOf(page, nodeNamed(before, 'five').id)

  const result = await callOk(page, 'arrange_nodes', { action: 'align_left', node_ids: ids })
  expect(result).toEqual({ action: 'align_left', arranged: 2, settled: true })
  const after = await layoutGraph(page)
  expect(ids.map((id) => after.nodes.find((n) => n.id === id)?.position?.x)).toEqual([
    -2000, -2000, -2000,
  ])
  expect(ids.map((id) => after.nodes.find((n) => n.id === id)?.position?.y)).toEqual([
    -2000, -1800, -1600,
  ])
  // Neither the view nor the selection changed.
  expect(after.view).toEqual(before.view)
  expect(after.selection).toEqual(before.selection)
  expect(after.selection).toEqual([nodeNamed(before, 'five').id])
  expect(await boxOf(page, nodeNamed(before, 'five').id)).toEqual(fiveBox)
})

test('arrange_nodes align refuses fewer than two nodes', async ({ editorPage, page }) => {
  await editorPage
  const five = nodeNamed(await layoutGraph(page), 'five')
  const refused = await deliver(page, 'arrange_nodes', {
    action: 'align_top',
    node_ids: [five.id],
  })
  expect(refused.ok).toBe(false)
  expect(refused.error).toContain('at least two')
})

test('arrange_nodes tidy lays the graph out, and one undo restores it', async ({
  editorPage,
  page,
}) => {
  await editorPage
  await selectFive(page)
  const before = await positions(page)
  const selection = (await layoutGraph(page)).selection

  const result = await callOk(page, 'arrange_nodes', { action: 'tidy' })
  expect(result.action).toBe('tidy')
  expect(result.arranged).toBeGreaterThan(0)
  const tidied = await positions(page)
  const changed = [...tidied].filter(
    ([id, p]) => JSON.stringify(p) !== JSON.stringify(before.get(id)),
  )
  expect(changed.length).toBe(result.arranged)
  expect((await layoutGraph(page)).selection).toEqual(selection)

  await page.keyboard.press('ControlOrMeta+Z')
  await expect
    .poll(async () => Object.fromEntries(await positions(page)))
    .toEqual(Object.fromEntries(before))
})

test('in Live mode arrange_nodes is refused and nothing moves', async ({ editorPage, page }) => {
  await editorPage
  const before = await positions(page)
  await goLive()
  const refused = await deliver(page, 'arrange_nodes', { action: 'tidy' })
  expect(refused.ok).toBe(false)
  expect(refused.error).toContain('Live mode')
  expect(await positions(page)).toEqual(before)
})

interface PreparedGraphImage {
  rect: { x: number; y: number; width: number; height: number }
  scale: number
  nodes: number
}

test('prepare_graph_image frames every node in the viewport and answers where the viewport is', async ({
  editorPage,
  page,
}) => {
  await editorPage
  const graph = await layoutGraph(page)
  // Spread the graph wider than the viewport, so that it must zoom out.
  const five = nodeNamed(graph, 'five')
  assert(five.position != null)
  await callOk(page, 'move_nodes', {
    moves: [{ node_id: five.id, x: five.position.x + 3000, y: five.position.y + 1500 }],
  })

  const prepared: PreparedGraphImage = await callOk(page, 'prepare_graph_image', {})
  expect(prepared.nodes).toBe(graph.nodes.length)
  expect(prepared.scale).toBeGreaterThanOrEqual(0.1)
  expect(prepared.scale).toBeLessThan(1)
  const viewport = await locate.graphEditor(page).locator('.viewport').boundingBox()
  assert(viewport != null)
  expect(Math.abs(prepared.rect.x - viewport.x)).toBeLessThanOrEqual(1)
  expect(Math.abs(prepared.rect.y - viewport.y)).toBeLessThanOrEqual(1)
  expect(Math.abs(prepared.rect.width - viewport.width)).toBeLessThanOrEqual(1)
  expect(Math.abs(prepared.rect.height - viewport.height)).toBeLessThanOrEqual(1)
  for (const node of graph.nodes) {
    const box = await boxOf(page, node.id)
    expect(box.x, node.name ?? node.id).toBeGreaterThanOrEqual(viewport.x)
    expect(box.y, node.name ?? node.id).toBeGreaterThanOrEqual(viewport.y)
    expect(box.x + box.width, node.name ?? node.id).toBeLessThanOrEqual(viewport.x + viewport.width)
    expect(box.y + box.height, node.name ?? node.id).toBeLessThanOrEqual(
      viewport.y + viewport.height,
    )
  }
  // The view stays where the picture left it.
  expect((await layoutGraph(page)).view.scale).toBeCloseTo(prepared.scale, 2)
})

test('prepare_graph_image of one node frames it at 100%', async ({ editorPage, page }) => {
  await editorPage
  const five = nodeNamed(await layoutGraph(page), 'five')
  const prepared: PreparedGraphImage = await callOk(page, 'prepare_graph_image', {
    node_ids: [five.id],
  })
  expect(prepared).toEqual(expect.objectContaining({ scale: 1, nodes: 1 }))
  const viewport = await locate.graphEditor(page).locator('.viewport').boundingBox()
  assert(viewport != null)
  const box = await boxOf(page, five.id)
  expect(box.x).toBeGreaterThanOrEqual(viewport.x)
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.x + viewport.width)
})

test('prepare_graph_image works in Live mode, and refuses an unknown node', async ({
  editorPage,
  page,
}) => {
  await editorPage
  await goLive()
  const prepared: PreparedGraphImage = await callOk(page, 'prepare_graph_image', {})
  expect(prepared.nodes).toBeGreaterThan(0)
  const refused = await deliver(page, 'prepare_graph_image', { node_ids: ['nope'] })
  expect(refused.ok).toBe(false)
  expect(refused.error).toContain('nope')
})
