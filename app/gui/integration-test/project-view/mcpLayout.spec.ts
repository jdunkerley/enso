/* eslint-disable camelcase -- tool argument names are snake_case on the wire */
/**
 * @file The MCP layout tools driving the real graph editor: `get_graph { layout: true }` and
 * `move_nodes`. A call is delivered as Electron main would (`window.__mcpCall`,
 * `mock/registerMocks.ts`); the spec checks the nodes on screen and the undo stack. A move changes
 * nothing the engine computes, so no call waits for the mock engine's results.
 */
import assert from 'assert'
import { expect, test, type Page } from 'integration-test/base'
import { mockExecutionEnvironment, setMockExecutionMode } from 'integration-test/mock/lsHandler'

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
