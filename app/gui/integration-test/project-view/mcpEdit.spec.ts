/* eslint-disable camelcase -- tool argument names are snake_case on the wire */
/**
 * @file The MCP edit and view tools driving the real graph editor: a tool call is delivered as
 * Electron main would (`window.__mcpCall`, `mock/registerMocks.ts`), the window's dispatcher runs
 * the project's handler, and the spec checks the editor and its undo stack. The mock language
 * server reports no types, so no test asserts one.
 */
import assert from 'assert'
import { expect, test, type Page } from 'integration-test/base'
import { mockExecutionComplete, mockExpressionValues } from 'integration-test/mock/lsHandler'
import * as locate from './locate'

// Each test opens the project and makes several edits, each waiting for the graph and an
// execution: the first test of a worker took ~20 s of the default 25 s on a cold dev server.
test.setTimeout(60_000)

interface ToolResult {
  ok: boolean
  value?: string
  error?: string
}

interface GraphNode {
  id: string
  name: string | null
  code: string
}

interface Graph {
  method: string
  nodes: GraphNode[]
  selection: string[]
}

/** How often the mock engine reports results while a call is running. */
const EXECUTION_INTERVAL_MS = 200

/** The tools that wait for the engine's results for the nodes they change. */
const EDIT_TOOLS = new Set(['add_nodes', 'edit_node', 'remove_nodes', 'collapse_nodes'])

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

/**
 * Delivers the tool call and resolves with its result. The mock never evaluates by itself, so
 * meanwhile, every {@link EXECUTION_INTERVAL_MS}, it does what the engine does after an edit: an
 * edit tool's call gets a value reported for every node of the method on screen (an edit settles
 * once its own nodes are reported), and every call an `executionComplete`.
 */
async function call(page: Page, tool: string, args: object = {}): Promise<ToolResult> {
  let done = false
  const result = deliver(page, tool, args).finally(() => (done = true))
  while (!done) {
    await new Promise((resolve) => setTimeout(resolve, EXECUTION_INTERVAL_MS))
    if (done) break
    if (EDIT_TOOLS.has(tool)) {
      const graph = await deliver(page, 'get_graph', { previews: false })
      if (graph.ok && !done) {
        mockExpressionValues((JSON.parse(graph.value!) as Graph).nodes.map((node) => node.id))
      }
    }
    if (!done) mockExecutionComplete()
  }
  return result
}

/** The tool's value, parsed; fails the test on an error. */
async function callOk(page: Page, tool: string, args: object = {}) {
  const result = await call(page, tool, args)
  assert(result.ok, `${tool} failed: ${result.error}`)
  return JSON.parse(result.value!)
}

async function getGraph(page: Page): Promise<Graph> {
  return callOk(page, 'get_graph', { previews: false })
}

async function nodeId(page: Page, name: string): Promise<string> {
  const node = (await getGraph(page)).nodes.find((n) => n.name === name)
  assert(node != null, `no node ${name}`)
  return node.id
}

/**
 * Selects `five` by clicking it: a press ends the initial view's following of the graph, so the
 * view moves only when something moves it.
 */
async function selectFive(page: Page) {
  await locate.graphNodeByBinding(page, 'five').locator('.grab-handle').click()
  await expect(locate.selectedNodes(page)).toHaveCount(1)
}

test('add_nodes adds the nodes with their names, without moving the view or the selection, as one undo step', async ({
  editorPage,
  page,
}) => {
  await editorPage
  await selectFive(page)
  const nodesCount = await locate.graphNode(page).count()
  const fiveBox = await locate.graphNodeByBinding(page, 'five').boundingBox()

  const result = await callOk(page, 'add_nodes', { statements: ['c = ten + 1', 'd = c * 2'] })
  expect(result.settled).toBe(true)
  expect(result.nodes.map((n: GraphNode) => [n.name, n.code])).toEqual([
    ['c', 'ten + 1'],
    ['d', 'c * 2'],
  ])
  await expect(locate.graphNode(page)).toHaveCount(nodesCount + 2)
  await expect(locate.graphNodeByBinding(page, 'c')).toBeVisible()
  await expect(locate.graphNodeByBinding(page, 'd')).toBeVisible()
  // The view did not move, and the selection is what it was.
  expect(await locate.graphNodeByBinding(page, 'five').boundingBox()).toEqual(fiveBox)
  await expect(locate.selectedNodes(page)).toHaveCount(1)
  await expect(locate.graphNodeByBinding(page, 'five')).toBeSelected()

  await page.keyboard.press('ControlOrMeta+Z')
  await expect(locate.graphNode(page)).toHaveCount(nodesCount)
  await expect(locate.graphNodeByBinding(page, 'c')).toBeHidden()
  await expect(locate.graphNodeByBinding(page, 'd')).toBeHidden()

  await page.keyboard.press('ControlOrMeta+Shift+Z')
  await expect(locate.graphNode(page)).toHaveCount(nodesCount + 2)
  await expect(locate.graphNodeByBinding(page, 'c')).toBeVisible()
  await expect(locate.graphNodeByBinding(page, 'd')).toBeVisible()
})

test('edit_node changes the code; remove_nodes removes the node and one undo restores it', async ({
  editorPage,
  page,
}) => {
  await editorPage
  const nodesCount = await locate.graphNode(page).count()
  const ten = await nodeId(page, 'ten')

  const edited = await callOk(page, 'edit_node', { node_id: ten, expression: 'five * 2' })
  expect(edited.nodes).toEqual([
    expect.objectContaining({ id: ten, name: 'ten', code: 'five * 2' }),
  ])
  await expect(locate.graphNodeByBinding(page, 'ten')).toContainText('five')

  const removed = await callOk(page, 'remove_nodes', { node_ids: [ten] })
  expect(removed.removed).toEqual([ten])
  await expect(locate.graphNode(page)).toHaveCount(nodesCount - 1)
  await expect(locate.graphNodeByBinding(page, 'ten')).toBeHidden()

  await page.keyboard.press('ControlOrMeta+Z')
  await expect(locate.graphNode(page)).toHaveCount(nodesCount)
  await expect(locate.graphNodeByBinding(page, 'ten')).toBeVisible()
})

test("an agent's consecutive edits are one undo step", async ({ editorPage, page }) => {
  await editorPage
  const nodesCount = await locate.graphNode(page).count()
  await callOk(page, 'add_nodes', { statements: ['c = 1'] })
  const twenty = await nodeId(page, 'twenty')
  await callOk(page, 'edit_node', { node_id: twenty, expression: 'five * 4' })
  await expect(locate.graphNodeByBinding(page, 'twenty')).toContainText('five')

  await page.keyboard.press('ControlOrMeta+Z')
  await expect(locate.graphNode(page)).toHaveCount(nodesCount)
  await expect(locate.graphNodeByBinding(page, 'twenty')).not.toContainText('five')
  expect((await getGraph(page)).nodes.find((n) => n.id === twenty)?.code).toBe('20')
})

test("a user's edit between two agent calls splits the undo steps", async ({
  editorPage,
  page,
}) => {
  await editorPage
  const nodesCount = await locate.graphNode(page).count()
  await callOk(page, 'add_nodes', { statements: ['agent_one = 1'] })
  await expect(locate.graphNodeByBinding(page, 'agent_one')).toBeVisible()

  // The user deletes a node.
  await locate.graphNodeByBinding(page, 'list').locator('.grab-handle').click()
  await page.keyboard.press('Delete')
  await expect(locate.graphNodeByBinding(page, 'list')).toBeHidden()

  await callOk(page, 'add_nodes', { statements: ['agent_two = 2'] })
  await expect(locate.graphNodeByBinding(page, 'agent_two')).toBeVisible()
  await expect(locate.graphNode(page)).toHaveCount(nodesCount + 1)

  // Each undo takes back one of the three, latest first.
  await page.keyboard.press('ControlOrMeta+Z')
  await expect(locate.graphNodeByBinding(page, 'agent_two')).toBeHidden()
  await expect(locate.graphNodeByBinding(page, 'list')).toBeHidden()
  await expect(locate.graphNodeByBinding(page, 'agent_one')).toBeVisible()

  await page.keyboard.press('ControlOrMeta+Z')
  await expect(locate.graphNodeByBinding(page, 'list')).toBeVisible()
  await expect(locate.graphNodeByBinding(page, 'agent_one')).toBeVisible()

  await page.keyboard.press('ControlOrMeta+Z')
  await expect(locate.graphNodeByBinding(page, 'agent_one')).toBeHidden()
  await expect(locate.graphNode(page)).toHaveCount(nodesCount)
})

test("a user's node drag between two agent calls is an undo step of its own", async ({
  editorPage,
  page,
}) => {
  await editorPage
  await callOk(page, 'add_nodes', { statements: ['agent_one = 1'] })
  await expect(locate.graphNodeByBinding(page, 'agent_one')).toBeVisible()
  const five = locate.graphNodeByBinding(page, 'five')
  const before = await five.boundingBox()
  assert(before != null)

  await editorPage.dragNode('five', { x: 0, y: 120 })
  await expect.poll(async () => (await five.boundingBox())?.y).toBeGreaterThan(before.y + 50)
  const moved = await five.boundingBox()

  await callOk(page, 'add_nodes', { statements: ['agent_two = 2'] })
  await expect(locate.graphNodeByBinding(page, 'agent_two')).toBeVisible()

  await page.keyboard.press('ControlOrMeta+Z')
  await expect(locate.graphNodeByBinding(page, 'agent_two')).toBeHidden()
  expect(await five.boundingBox()).toEqual(moved)

  await page.keyboard.press('ControlOrMeta+Z')
  await expect.poll(async () => (await five.boundingBox())?.y).toBeCloseTo(before.y, 0)
  await expect(locate.graphNodeByBinding(page, 'agent_one')).toBeVisible()

  await page.keyboard.press('ControlOrMeta+Z')
  await expect(locate.graphNodeByBinding(page, 'agent_one')).toBeHidden()
})

test('select_nodes selects the nodes, and get_graph reports the selection', async ({
  editorPage,
  page,
}) => {
  await editorPage
  expect((await getGraph(page)).selection).toEqual([])
  const sum = await nodeId(page, 'sum')
  const prod = await nodeId(page, 'prod')

  const result = await callOk(page, 'select_nodes', { node_ids: [prod, sum] })
  expect([...result.selected].sort()).toEqual([sum, prod].sort())
  await expect(locate.selectedNodes(page)).toHaveCount(2)
  await expect(locate.graphNodeByBinding(page, 'sum')).toBeSelected()
  await expect(locate.graphNodeByBinding(page, 'prod')).toBeSelected()
  expect([...(await getGraph(page)).selection].sort()).toEqual([sum, prod].sort())

  expect(await callOk(page, 'select_nodes', { node_ids: [] })).toEqual({ selected: [] })
  await expect(locate.selectedNodes(page)).toHaveCount(0)
})

test('set_node_comment sets the comment as one undo step', async ({ editorPage, page }) => {
  await editorPage
  const final = await nodeId(page, 'final')
  const node = locate.graphNodeByBinding(page, 'final')
  await expect(locate.nodeCommentContent(node)).toHaveText('This node can be entered')
  const result = await callOk(page, 'set_node_comment', { node_id: final, text: 'Ten of them' })
  expect(result.node).toEqual(expect.objectContaining({ id: final, comment: 'Ten of them' }))
  await expect(locate.nodeCommentContent(node)).toHaveText('Ten of them')

  await page.keyboard.press('ControlOrMeta+Z')
  await expect(locate.nodeCommentContent(node)).toHaveText('This node can be entered')
})

test('set_node_comment shows a comment on a node that had none; undo removes it', async ({
  editorPage,
  page,
}) => {
  await editorPage
  const ten = await nodeId(page, 'ten')
  const node = locate.graphNodeByBinding(page, 'ten')
  await expect(locate.nodeCommentContent(node)).toBeHidden()
  await callOk(page, 'set_node_comment', { node_id: ten, text: 'Ten of them' })
  await expect(locate.nodeCommentContent(node)).toHaveText('Ten of them')

  await page.keyboard.press('ControlOrMeta+Z')
  await expect(locate.nodeCommentContent(node)).toBeHidden()
})

test('collapse_nodes groups the nodes into a function, as one undo step', async ({
  editorPage,
  page,
}) => {
  await editorPage
  const nodesCount = await locate.graphNode(page).count()
  const sum = await nodeId(page, 'sum')
  const prod = await nodeId(page, 'prod')

  const result = await callOk(page, 'collapse_nodes', { node_ids: [sum, prod], name: 'add_up' })
  expect(result.name).toBe('add_up')
  await expect(locate.graphNode(page)).toHaveCount(nodesCount - 1)
  const prodNode = (await getGraph(page)).nodes.find((n) => n.name === 'prod')
  expect(prodNode?.code).toContain('add_up')

  await page.keyboard.press('ControlOrMeta+Z')
  await expect(locate.graphNode(page)).toHaveCount(nodesCount)
  await expect(locate.graphNodeByBinding(page, 'sum')).toBeVisible()
})

test('open_method enters a function and goes back', async ({ editorPage, page }) => {
  await editorPage.mockUserDefinedFunctionInfo('final', 'func1')
  const final = await nodeId(page, 'final')
  expect(await callOk(page, 'open_method', { node_id: final })).toEqual({ method: 'func1' })
  await expect(locate.graphNodeByBinding(page, 'f2')).toBeVisible()
  expect((await getGraph(page)).method).toBe('func1')

  expect(await callOk(page, 'open_method')).toEqual({ method: 'main' })
  await expect(locate.graphNodeByBinding(page, 'final')).toBeVisible()
  expect(await call(page, 'open_method')).toEqual({
    ok: false,
    error: 'Already at the top level.',
  })
  const ten = await nodeId(page, 'ten')
  expect(await call(page, 'open_method', { node_id: ten })).toEqual({
    ok: false,
    error: 'That node is not a component defined in this project.',
  })
})
