/* eslint-disable camelcase -- tool argument names are snake_case on the wire */
/**
 * @file The MCP `undo` and `redo` tools driving the real graph editor: a call is delivered as
 * Electron main would (`window.__mcpCall`, `mock/registerMocks.ts`). The spec checks the nodes on
 * screen, that the user's own edits are never taken back, and that Live mode refuses both.
 */
import assert from 'assert'
import { expect, test, type Page } from 'integration-test/base'
import {
  mockExecutionComplete,
  mockExecutionEnvironment,
  mockExpressionValues,
  setMockExecutionMode,
} from 'integration-test/mock/lsHandler'
import * as locate from './locate'

// Each test opens the project and makes several edits, each waiting for the graph and an execution.
test.setTimeout(60_000)

interface ToolResult {
  ok: boolean
  value?: string
  error?: string
}

interface Graph {
  nodes: { id: string; name: string | null; code: string }[]
}

/** How often the mock engine reports results while a call is running. */
const EXECUTION_INTERVAL_MS = 200

/** The tools that wait for the engine's results for the nodes they change. */
const EDIT_TOOLS = new Set(['add_nodes', 'undo', 'redo'])

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
 * Delivers the tool call. The mock never evaluates by itself, so meanwhile, every
 * {@link EXECUTION_INTERVAL_MS}, it does what the engine does after an edit: reports a value for
 * every node of the method on screen, and an `executionComplete`.
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

/** The user deletes the node `name` with the keyboard. */
async function userDeletes(page: Page, name: string) {
  await locate.graphNodeByBinding(page, name).locator('.grab-handle').click()
  await page.keyboard.press('Delete')
  await expect(locate.graphNodeByBinding(page, name)).toBeHidden()
}

test('undo removes what an agent added and redo brings it back', async ({ editorPage, page }) => {
  await editorPage
  const nodesCount = await locate.graphNode(page).count()
  await callOk(page, 'add_nodes', { statements: ['agent_one = 1'] })
  await expect(locate.graphNodeByBinding(page, 'agent_one')).toBeVisible()
  const added = (await callOk(page, 'get_graph', { previews: false })) as Graph
  const id = added.nodes.find((n) => n.name === 'agent_one')?.id
  assert(id != null)

  const undone = await callOk(page, 'undo')
  expect(undone).toEqual({ undone: true, can_undo: false, can_redo: true, settled: true })
  await expect(locate.graphNodeByBinding(page, 'agent_one')).toBeHidden()
  await expect(locate.graphNode(page)).toHaveCount(nodesCount)

  const redone = await callOk(page, 'redo')
  expect(redone).toEqual({ redone: true, can_undo: true, can_redo: false, settled: true })
  await expect(locate.graphNodeByBinding(page, 'agent_one')).toBeVisible()
  // The node has the id it had before.
  const back = (await callOk(page, 'get_graph', { previews: false })) as Graph
  expect(back.nodes.find((n) => n.name === 'agent_one')?.id).toBe(id)
})

test('undo with nothing to undo is refused', async ({ editorPage, page }) => {
  await editorPage
  const refused = await call(page, 'undo')
  expect(refused.ok).toBe(false)
  expect(refused.error).toContain('nothing of yours to undo')
  const redo = await call(page, 'redo')
  expect(redo.ok).toBe(false)
  expect(redo.error).toContain('nothing to redo')
})

test("undo never takes back the user's edit, and leaves it intact", async ({
  editorPage,
  page,
}) => {
  await editorPage
  await callOk(page, 'add_nodes', { statements: ['agent_one = 1'] })
  await expect(locate.graphNodeByBinding(page, 'agent_one')).toBeVisible()
  await userDeletes(page, 'list')

  const refused = await call(page, 'undo')
  expect(refused.ok).toBe(false)
  expect(refused.error).toContain('nothing of yours to undo')
  // Neither the user's deletion nor the agent's node earlier than it was touched.
  await expect(locate.graphNodeByBinding(page, 'list')).toBeHidden()
  await expect(locate.graphNodeByBinding(page, 'agent_one')).toBeVisible()
})

test('a user edit after an undo ends the redo', async ({ editorPage, page }) => {
  await editorPage
  await callOk(page, 'add_nodes', { statements: ['agent_one = 1'] })
  await callOk(page, 'undo')
  await expect(locate.graphNodeByBinding(page, 'agent_one')).toBeHidden()
  await userDeletes(page, 'list')

  const refused = await call(page, 'redo')
  expect(refused.ok).toBe(false)
  expect(refused.error).toContain('nothing to redo')
  await expect(locate.graphNodeByBinding(page, 'agent_one')).toBeHidden()
})

test('in Live mode undo and redo are refused and nothing changes', async ({ editorPage, page }) => {
  await editorPage
  await callOk(page, 'add_nodes', { statements: ['agent_one = 1'] })
  await expect(locate.graphNodeByBinding(page, 'agent_one')).toBeVisible()
  setMockExecutionMode('live')
  await expect.poll(mockExecutionEnvironment).toBe('Live')

  for (const tool of ['undo', 'redo']) {
    const refused = await deliver(page, tool, {})
    expect(refused.ok).toBe(false)
    expect(refused.error).toContain('Live mode')
  }
  await expect(locate.graphNodeByBinding(page, 'agent_one')).toBeVisible()
})
