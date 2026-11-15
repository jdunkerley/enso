/* eslint-disable camelcase -- argument names are snake_case on the wire */
import { GraphDb, type NodeId } from '$/providers/openedProjects/graph/graphDatabase'
import { mockProjectNameStore } from '$/providers/openedProjects/projectNames'
import { assert } from '@/util/assert'
import { Ast } from '@/util/ast'
import type { McpToolResult } from 'enso-common/src/mcp'
import { expect, test, vi } from 'vitest'
import { watchEffect } from 'vue'
import {
  ALREADY_AT_TOP_ERROR,
  NOT_ENTERABLE_ERROR,
  OPEN_METHOD_WAIT_MS,
  openMethod,
  selectNodes,
  type ViewToolDeps,
} from '../viewTools'

const CODE = `main =
    a = 1 + 2
    b = a * 2
    b`

function makeDeps(overrides: Partial<ViewToolDeps> = {}) {
  const projectNames = mockProjectNameStore()
  const db = GraphDb.Mock(undefined, undefined, projectNames)
  const { root, getSpan } = Ast.parseUpdatingIdMap(CODE)
  const func = Ast.findModuleMethod(root, 'main')?.statement
  assert(func instanceof Ast.MutableFunctionDef)
  db.updateExternalIds(root)
  db.updateNodes(func, { watchEffect })
  db.updateBindings(func, { text: CODE, getSpan })
  let selected = new Set<NodeId>()
  let method = 'main'
  const log: string[] = []
  const deps: ViewToolDeps = {
    db,
    select: vi.fn((ids: readonly NodeId[]) => {
      selected = new Set(ids)
      log.push(`select:${ids.length}`)
    }),
    selected: () => selected,
    nodeCanBeEntered: vi.fn(() => true),
    enterNode: vi.fn(() => {
      log.push('enter')
      method = 'func1'
    }),
    canLeave: vi.fn(() => true),
    leaveMethod: vi.fn(() => {
      log.push('leave')
      method = 'main'
    }),
    waitForGraph: vi.fn(async () => {
      log.push('wait')
    }),
    currentMethodName: () => method,
    contextChanged: vi.fn(() => log.push('release')),
    ...overrides,
  }
  return { deps, db, log }
}

function nodeNamed(db: GraphDb, name: string): NodeId {
  const id = db.getIdentDefiningNode(name)
  assert(id != null)
  return id
}

function valueOf(result: McpToolResult) {
  assert(result.ok, `expected ok, got ${result.ok ? '' : result.error}`)
  return JSON.parse(result.value)
}

function toolError(result: McpToolResult): string {
  assert(!result.ok, 'expected an error')
  return result.error
}

// === select_nodes ===

test('select_nodes selects the nodes once each and answers with the selection', async () => {
  const { deps, db } = makeDeps()
  const a = nodeNamed(db, 'a')
  const b = nodeNamed(db, 'b')
  const result = valueOf(await selectNodes(deps, { node_ids: [b, a, b] }))
  expect(deps.select).toHaveBeenCalledWith([b, a])
  expect(result).toEqual({ selected: [b, a] })
})

test('select_nodes with an empty list clears the selection', async () => {
  const { deps, db } = makeDeps()
  await selectNodes(deps, { node_ids: [nodeNamed(db, 'a')] })
  const result = valueOf(await selectNodes(deps, { node_ids: [] }))
  expect(deps.select).toHaveBeenLastCalledWith([])
  expect(result).toEqual({ selected: [] })
})

test('select_nodes with an unknown id changes nothing', async () => {
  const { deps, db } = makeDeps()
  const result = await selectNodes(deps, { node_ids: [nodeNamed(db, 'a'), 'nope'] })
  expect(toolError(result)).toBe(
    'No node with id nope in the method on screen. Call get_graph for the current ids.',
  )
  expect(deps.select).not.toHaveBeenCalled()
})

// === open_method ===

test('open_method enters the node, releases the edit step, waits for the graph and answers with the method', async () => {
  const { deps, db, log } = makeDeps()
  const b = nodeNamed(db, 'b')
  const result = valueOf(await openMethod(deps, { node_id: b }))
  expect(deps.enterNode).toHaveBeenCalledWith(b)
  expect(deps.waitForGraph).toHaveBeenCalledWith(OPEN_METHOD_WAIT_MS)
  expect(log).toEqual(['enter', 'release', 'wait'])
  expect(result).toEqual({ method: 'func1' })
})

test('open_method refuses a node that cannot be entered', async () => {
  const { deps, db } = makeDeps({ nodeCanBeEntered: vi.fn(() => false) })
  const result = await openMethod(deps, { node_id: nodeNamed(db, 'a') })
  expect(toolError(result)).toBe(NOT_ENTERABLE_ERROR)
  expect(NOT_ENTERABLE_ERROR).toBe('That node is not a component defined in this project.')
  expect(deps.enterNode).not.toHaveBeenCalled()
  expect(deps.contextChanged).not.toHaveBeenCalled()
})

test('open_method refuses an unknown node', async () => {
  const { deps } = makeDeps()
  const result = await openMethod(deps, { node_id: 'nope' })
  expect(toolError(result)).toContain('No node with id nope')
  expect(deps.enterNode).not.toHaveBeenCalled()
})

test('open_method without a node leaves the method', async () => {
  const { deps, log } = makeDeps({ currentMethodName: () => 'main' })
  const result = valueOf(await openMethod(deps, {}))
  expect(log).toEqual(['leave', 'release', 'wait'])
  expect(result).toEqual({ method: 'main' })
})

test('open_method without a node at the top level is refused', async () => {
  const { deps } = makeDeps({ canLeave: vi.fn(() => false) })
  const result = await openMethod(deps, {})
  expect(toolError(result)).toBe(ALREADY_AT_TOP_ERROR)
  expect(ALREADY_AT_TOP_ERROR).toBe('Already at the top level.')
  expect(deps.leaveMethod).not.toHaveBeenCalled()
  expect(deps.contextChanged).not.toHaveBeenCalled()
})

test('open_method answers an error when the graph shows no method afterwards', async () => {
  const { deps, db } = makeDeps({ currentMethodName: () => undefined })
  const result = await openMethod(deps, { node_id: nodeNamed(db, 'b') })
  expect(toolError(result)).toBe('The graph editor shows no method now. Call get_graph.')
})
