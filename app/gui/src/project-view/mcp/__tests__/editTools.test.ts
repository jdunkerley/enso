/* eslint-disable camelcase -- argument names are snake_case on the wire */
import { GraphDb, asNodeId, type NodeId } from '$/providers/openedProjects/graph/graphDatabase'
import { mockProjectNameStore } from '$/providers/openedProjects/projectNames'
import { assert } from '@/util/assert'
import { Ast } from '@/util/ast'
import type { MethodPointer } from '@/util/methodPointer'
import { stdPath } from '@/util/projectPath'
import type { Identifier } from '@/util/qualifiedName'
import type { McpToolResult } from 'enso-common/src/mcp'
import { Err, Ok, type Result } from 'enso-common/src/utilities/data/result'
import { expect, test, vi } from 'vitest'
import { watchEffect } from 'vue'
import type { ExternalId } from 'ydoc-shared/yjsModel'
import { EditSession, LIVE_EDIT_ERROR, type EditOutcome } from '../editSession'
import {
  MISSING_NODES_NOTE,
  UNSETTLED_NOTE,
  addNodes,
  editNode,
  parseNodeStatement,
  removeNodes,
  setNodeComment,
  setVisualization,
  type EditToolDeps,
} from '../editTools'

// === parseNodeStatement ===

function errorOf(result: Result<unknown>): string {
  if (result.ok) throw new Error('expected Err')
  return result.error.message('')
}

test('An assignment gives its name and expression', () => {
  expect(parseNodeStatement('a = 1 + 2')).toEqual(Ok({ binding: 'a', expression: '1 + 2' }))
})

test('A bare expression has no name', () => {
  expect(parseNodeStatement('Data.read "x"')).toEqual(
    Ok({ binding: undefined, expression: 'Data.read "x"' }),
  )
})

test('An expression continued on indented lines is one statement', () => {
  const statement = 'a = foo\n    . bar\n    . baz'
  const parsed = parseNodeStatement(statement)
  expect(parsed).toEqual(Ok({ binding: 'a', expression: 'foo\n    . bar\n    . baz' }))
  assert(parsed.ok)
  // The expression is what node creation parses again.
  expect(Ast.parseExpression(parsed.value.expression)?.code()).toBe(parsed.value.expression)
})

test('A function definition is refused', () => {
  expect(errorOf(parseNodeStatement('f x = x + 1'))).toContain('function definition')
})

test('An import is refused, pointing at `imports`', () => {
  expect(errorOf(parseNodeStatement('import Standard.Base'))).toContain('`imports`')
})

test('An assignment without an expression is refused', () => {
  expect(errorOf(parseNodeStatement('a = '))).toContain('no expression')
})

test('Two statements, an empty statement and a syntax error are refused', () => {
  expect(errorOf(parseNodeStatement('a = 1\nb = 2'))).toContain('not one statement')
  expect(errorOf(parseNodeStatement('   '))).toContain('not one statement')
  expect(errorOf(parseNodeStatement('a = foo ('))).toContain('syntax error')
})

test('A pattern on the left is refused, asking for one name', () => {
  expect(errorOf(parseNodeStatement('[a, b] = foo'))).toContain('Bind one name')
  expect(errorOf(parseNodeStatement('Foo = 1'))).toContain('Bind one name')
})

// === The tools ===

const CODE = `main =
    a = 1 + 2
    ## Doubles the sum.
    b = a * 2
    b`

const pointer: MethodPointer = {
  module: stdPath('Standard.Base.Main'),
  definedOnType: stdPath('Standard.Base.Main'),
  name: 'main' as Identifier,
}

const caller = { kind: 'external', name: 'claude-code' } as const

/** A session that runs each edit at once and reports `settled`. */
function fakeSession(settled = true): Pick<EditSession, 'run'> {
  return {
    async run<T>(_caller: unknown, edit: () => Result<T> | Promise<Result<T>>) {
      const result = await edit()
      return result.ok ? Ok<EditOutcome<T>>({ value: result.value, settled }) : result
    },
  }
}

function makeDeps(overrides: Partial<EditToolDeps> = {}) {
  const projectNames = mockProjectNameStore()
  const db = GraphDb.Mock(undefined, undefined, projectNames)
  const { root, getSpan } = Ast.parseUpdatingIdMap(CODE)
  const func = [...root.statements()].find((s) => s instanceof Ast.FunctionDef)
  assert(func instanceof Ast.MutableFunctionDef)
  db.updateExternalIds(root)
  db.updateNodes(func, { watchEffect })
  db.updateBindings(func, { text: CODE, getSpan })
  const createNodes = vi.fn<EditToolDeps['createNodes']>(async (nodes) =>
    Ok(
      nodes.map((n, i) => {
        const id = asNodeId(crypto.randomUUID() as ExternalId)
        db.mockNode(n.binding ?? `node${i + 1}`, id, n.expression)
        return id
      }),
    ),
  )
  const deps: EditToolDeps = {
    db,
    currentMethod: { ast: Ok(func), pointer: Ok(pointer) },
    moduleRoot: () => root,
    printType: projectNames.printProjectPath,
    evaluate: vi.fn(async () => Ok('text')),
    session: fakeSession(),
    caller,
    createNodes,
    setNodeContent: vi.fn(() => Ok()),
    deleteNodes: vi.fn(async () => Ok()),
    setNodeComment: vi.fn(() => Ok()),
    setVisualization: vi.fn(() => Ok()),
    ...overrides,
  }
  return { deps, db, createNodes }
}

function nodeNamed(db: GraphDb, name: string): NodeId {
  const id = db.getIdentDefiningNode(name)
  assert(id != null)
  return id
}

function outputNode(db: GraphDb): NodeId {
  const entry = [...db.nodeIdToNode.entries()].find(([, node]) => node.type === 'output')
  assert(entry != null)
  return entry[0]
}

function valueOf(result: McpToolResult) {
  assert(result.ok, `expected ok, got ${result.ok ? '' : result.error}`)
  return JSON.parse(result.value)
}

function toolError(result: McpToolResult): string {
  assert(!result.ok, 'expected an error')
  return result.error
}

test('add_nodes passes the parsed nodes, the anchor and the imports, and answers with the new nodes', async () => {
  const { deps, db, createNodes } = makeDeps()
  const a = nodeNamed(db, 'a')
  const result = valueOf(
    await addNodes(deps, {
      statements: ['c = b + 1', 'c.to_text'],
      after_node: a,
      imports: ['from Standard.Table import all'],
    }),
  )
  expect(createNodes).toHaveBeenCalledWith(
    [
      { binding: 'c', expression: 'b + 1' },
      { binding: undefined, expression: 'c.to_text' },
    ],
    a,
    ['from Standard.Table import all'],
  )
  expect(result.settled).toBe(true)
  expect(result).not.toHaveProperty('note')
  expect(result.nodes.map((n: { name: string; code: string }) => [n.name, n.code])).toEqual([
    ['c', 'b + 1'],
    ['node2', 'c.to_text'],
  ])
  expect(result.nodes.every((n: object) => !('preview' in n))).toBe(true)
})

test('add_nodes with an unknown `after_node` changes nothing', async () => {
  const { deps, createNodes } = makeDeps()
  const result = await addNodes(deps, { statements: ['c = 1'], after_node: 'nope' })
  expect(toolError(result)).toBe(
    'No node with id nope in the method on screen. Call get_graph for the current ids.',
  )
  expect(createNodes).not.toHaveBeenCalled()
})

test('add_nodes refuses a name already used in the method', async () => {
  const { deps, createNodes } = makeDeps()
  const result = await addNodes(deps, { statements: ['c = 1', 'a = 2'] })
  expect(toolError(result)).toContain('`a`')
  expect(toolError(result)).toContain('already')
  expect(createNodes).not.toHaveBeenCalled()
})

test('add_nodes refuses a name bound twice in the call', async () => {
  const { deps, createNodes } = makeDeps()
  const result = await addNodes(deps, { statements: ['c = 1', 'c = 2'] })
  expect(toolError(result)).toContain('`c`')
  expect(toolError(result)).toContain('twice')
  expect(createNodes).not.toHaveBeenCalled()
})

test('add_nodes refuses a statement that does not parse, naming it', async () => {
  const { deps, createNodes } = makeDeps()
  const result = await addNodes(deps, { statements: ['c = 1', 'f x = x'] })
  expect(toolError(result)).toContain('Statement 2')
  expect(createNodes).not.toHaveBeenCalled()
})

test('add_nodes refuses an import that does not parse', async () => {
  const { deps, createNodes } = makeDeps()
  const result = await addNodes(deps, { statements: ['c = 1'], imports: ['Standard.Table'] })
  expect(toolError(result)).toContain('Not an import line: `Standard.Table`')
  expect(createNodes).not.toHaveBeenCalled()
})

test('add_nodes reports an error from creating the nodes', async () => {
  const { deps } = makeDeps({ createNodes: vi.fn(async () => Err('No current method')) })
  expect(toolError(await addNodes(deps, { statements: ['c = 1'] }))).toBe('No current method')
})

test('add_nodes in Live mode is refused by the session, and nothing is created', async () => {
  const session = new EditSession({
    isLive: () => true,
    holdUndoStep: () => () => {},
    onForeignEdit: () => () => {},
    saveVersion: async () => {},
    afterGraphUpdate: async () => {},
    executionSettled: async () => true,
    setTimeout: () => undefined,
    clearTimeout: () => {},
  })
  const { deps, createNodes } = makeDeps({ session })
  expect(toolError(await addNodes(deps, { statements: ['c = 1'] }))).toBe(LIVE_EDIT_ERROR)
  expect(createNodes).not.toHaveBeenCalled()
})

test('add_nodes adds a note when execution has not finished', async () => {
  const { deps } = makeDeps({ session: fakeSession(false) })
  const result = valueOf(await addNodes(deps, { statements: ['c = 1'] }))
  expect(result.settled).toBe(false)
  expect(result.note).toBe(UNSETTLED_NOTE)
  expect(UNSETTLED_NOTE).toBe(
    'Execution has not finished. Call get_node later for the types and values.',
  )
})

test('add_nodes says so when a new node is not in the graph yet', async () => {
  const { deps } = makeDeps({
    createNodes: vi.fn(async () => Ok([asNodeId(crypto.randomUUID() as ExternalId)])),
  })
  const result = valueOf(await addNodes(deps, { statements: ['c = 1'] }))
  expect(result).toEqual({ nodes: [], settled: true, note: MISSING_NODES_NOTE })
})

test('edit_node sets the content and answers with the node', async () => {
  const { deps, db } = makeDeps()
  const a = nodeNamed(db, 'a')
  const result = valueOf(await editNode(deps, { node_id: a, expression: '5 * 5' }))
  expect(deps.setNodeContent).toHaveBeenCalledWith(a, '5 * 5')
  expect(result).toEqual({ nodes: [expect.objectContaining({ id: a, name: 'a' })], settled: true })
})

test('edit_node refuses an unknown node, a statement and a syntax error', async () => {
  const { deps, db } = makeDeps()
  expect(toolError(await editNode(deps, { node_id: 'nope', expression: '1' }))).toContain(
    'No node with id nope',
  )
  const a = nodeNamed(db, 'a')
  expect(toolError(await editNode(deps, { node_id: a, expression: 'x = 1' }))).toContain(
    'not one expression',
  )
  expect(toolError(await editNode(deps, { node_id: a, expression: 'foo (' }))).toContain(
    'syntax error',
  )
  expect(deps.setNodeContent).not.toHaveBeenCalled()
})

test('remove_nodes with one unknown id removes nothing', async () => {
  const { deps, db } = makeDeps()
  const a = nodeNamed(db, 'a')
  const result = await removeNodes(deps, { node_ids: [a, 'nope'] })
  expect(toolError(result)).toContain('No node with id nope')
  expect(deps.deleteNodes).not.toHaveBeenCalled()
})

test('remove_nodes refuses the output node', async () => {
  const { deps, db } = makeDeps()
  const result = await removeNodes(deps, { node_ids: [outputNode(db)] })
  expect(toolError(result)).toContain('cannot be removed')
  expect(deps.deleteNodes).not.toHaveBeenCalled()
})

test('remove_nodes deletes the nodes and lists them', async () => {
  const { deps, db } = makeDeps()
  const a = nodeNamed(db, 'a')
  const b = nodeNamed(db, 'b')
  const result = valueOf(await removeNodes(deps, { node_ids: [a, b, a] }))
  expect(deps.deleteNodes).toHaveBeenCalledWith([a, b])
  expect(result).toEqual({ removed: [a, b], settled: true })
})

test('set_node_comment writes the comment and answers with the node', async () => {
  const { deps, db } = makeDeps()
  const b = nodeNamed(db, 'b')
  const result = valueOf(await setNodeComment(deps, { node_id: b, text: 'Hello' }))
  expect(deps.setNodeComment).toHaveBeenCalledWith(b, 'Hello')
  expect(result).toEqual({ node: expect.objectContaining({ id: b, name: 'b' }) })
})

test('set_visualization shows the visualization and answers with the node', async () => {
  const { deps, db } = makeDeps()
  const a = nodeNamed(db, 'a')
  const result = valueOf(await setVisualization(deps, { node_id: a, visible: true }))
  expect(deps.setVisualization).toHaveBeenCalledWith(a, true)
  expect(result).toEqual({ node: expect.objectContaining({ id: a }) })
  expect(toolError(await setVisualization(deps, { node_id: 'nope', visible: false }))).toContain(
    'No node with id nope',
  )
})
