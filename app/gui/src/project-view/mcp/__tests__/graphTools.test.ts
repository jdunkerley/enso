/* eslint-disable camelcase -- tool names and argument names are snake_case on the wire */
import { GraphDb, asNodeId, type NodeId } from '$/providers/openedProjects/graph/graphDatabase'
import {
  ComputedValueRegistry,
  TypeInfo,
} from '$/providers/openedProjects/project/computedValueRegistry'
import { mockProjectNameStore } from '$/providers/openedProjects/projectNames'
import { assert } from '@/util/assert'
import { Ast } from '@/util/ast'
import type { MethodPointer } from '@/util/methodPointer'
import { stdPath } from '@/util/projectPath'
import type { Identifier } from '@/util/qualifiedName'
import { Err, Ok } from 'enso-common/src/utilities/data/result'
import { expect, test, vi } from 'vitest'
import { watchEffect } from 'vue'
import type { ExpressionUpdatePayload } from 'ydoc-shared/languageServerTypes'
import {
  GRAPH_PREVIEW_CHARS,
  NODE_PREVIEW_CHARS,
  getGraph,
  getNode,
  summarizeNode,
  type GraphToolDeps,
} from '../graphTools'

const CODE = `import Standard.Base.Data.Numbers
from Standard.Table import all

main =
    a = 1 + 2
    ## Doubles the sum.
    b = a * 2
    b`

const pointer: MethodPointer = {
  module: stdPath('Standard.Base.Main'),
  definedOnType: stdPath('Standard.Base.Main'),
  name: 'main' as Identifier,
}

function makeDeps(overrides: Partial<GraphToolDeps> = {}) {
  const registry = ComputedValueRegistry.Mock()
  const projectNames = mockProjectNameStore()
  const db = GraphDb.Mock(registry, undefined, projectNames)
  const { root, getSpan } = Ast.parseUpdatingIdMap(CODE)
  const func = [...root.statements()].find((s) => s instanceof Ast.FunctionDef)
  assert(func instanceof Ast.MutableFunctionDef)
  db.updateExternalIds(root)
  db.updateNodes(func, { watchEffect })
  db.updateBindings(func, { text: CODE, getSpan })
  const evaluate = vi.fn<GraphToolDeps['evaluate']>(async () => Ok('text'))
  const deps: GraphToolDeps = {
    db,
    currentMethod: { ast: Ok(func), pointer: Ok(pointer) },
    moduleRoot: () => root,
    printType: projectNames.printProjectPath,
    evaluate,
    ...overrides,
  }
  return { deps, db, registry, evaluate, func }
}

function setPayload(
  registry: ComputedValueRegistry,
  id: NodeId,
  payload: ExpressionUpdatePayload,
  type = 'Standard.Base.Data.Numbers.Integer',
) {
  registry.db.set(id, {
    typeInfo: TypeInfo.fromParsedTypes([stdPath(type)], []),
    methodCall: undefined,
    payload,
    profilingInfo: [],
    evaluationId: 1,
  })
}

function nodeNamed(db: GraphDb, name: string): NodeId {
  const id = db.getIdentDefiningNode(name)
  assert(id != null)
  return id
}

function parseValue(result: { ok: boolean; value?: string; error?: string }) {
  assert(result.ok, `expected ok, got ${result.error}`)
  return JSON.parse(result.value!)
}

test('A node with no computed value is summarised as unknown', () => {
  const { deps, db } = makeDeps()
  const id = asNodeId(crypto.randomUUID() as NodeId)
  const node = db.mockNode('a', id, '1 + 2')
  expect(summarizeNode(deps, id, node)).toEqual({
    id,
    name: 'a',
    code: '1 + 2',
    kind: 'component',
    type: null,
    state: 'unknown',
  })
})

test('A panicking node is summarised with its message', () => {
  const { deps, db, registry } = makeDeps()
  const id = asNodeId(crypto.randomUUID() as NodeId)
  const node = db.mockNode('a', id, '1 + 2')
  setPayload(registry, id, { type: 'Panic', message: 'Oops', trace: [] })
  expect(summarizeNode(deps, id, node)).toMatchObject({
    state: 'panic',
    message: 'Oops',
    type: 'Standard.Base.Data.Numbers.Integer',
  })
})

test('A value with warnings counts them, and a documented node has its comment', () => {
  const { deps, db, registry } = makeDeps()
  const id = nodeNamed(db, 'b')
  setPayload(registry, id, { type: 'Value', warnings: { count: 2 } })
  expect(summarizeNode(deps, id, db.nodeIdToNode.get(id)!)).toMatchObject({
    name: 'b',
    code: 'a * 2',
    state: 'value',
    warnings: 2,
    comment: 'Doubles the sum.',
  })
})

test('get_graph without previews never evaluates', async () => {
  const { deps, db, registry, evaluate } = makeDeps()
  setPayload(registry, nodeNamed(db, 'a'), { type: 'Value' })
  const graph = parseValue(await getGraph(deps, { previews: false }))
  expect(evaluate).not.toHaveBeenCalled()
  expect(graph.method).toBe('main')
  expect(graph.source).toBe(deps.currentMethod.ast.ok && deps.currentMethod.ast.value.code())
  expect(graph.imports).toEqual([
    'import Standard.Base.Data.Numbers',
    'from Standard.Table import all',
  ])
  expect(graph.nodes.map((n: { name: string | null }) => n.name)).toEqual(['a', 'b', null])
  expect(graph.nodes[2].kind).toBe('output')
  expect(graph.nodes.every((n: object) => !('preview' in n))).toBe(true)
})

test('get_graph previews each value node, cut to the limit, and leaves out failures', async () => {
  const { deps, db, registry, evaluate } = makeDeps()
  const a = nodeNamed(db, 'a')
  const b = nodeNamed(db, 'b')
  setPayload(registry, a, { type: 'Value' })
  setPayload(registry, b, { type: 'Value' })
  evaluate.mockImplementation(async (_scope, expression) =>
    expression.startsWith('a.') ? Ok('x'.repeat(3_000)) : Err('No such method'),
  )
  const graph = parseValue(await getGraph(deps, {}))
  expect(evaluate).toHaveBeenCalledTimes(2)
  expect(evaluate).toHaveBeenCalledWith(
    db.nodeIdToNode.get(a)!.outerAst.externalId,
    'a.to_display_text',
    5_000,
  )
  expect(evaluate).toHaveBeenCalledWith(
    db.nodeIdToNode.get(b)!.outerAst.externalId,
    'b.to_display_text',
    5_000,
  )
  expect(graph.nodes[0].preview).toBe('x'.repeat(GRAPH_PREVIEW_CHARS) + '…')
  expect(graph.nodes[1]).not.toHaveProperty('preview')
})

test('get_graph reports a method that cannot be read', async () => {
  const { deps } = makeDeps()
  const result = await getGraph(
    { ...deps, currentMethod: { ...deps.currentMethod, ast: Err('Method not found') } },
    {},
  )
  expect(result).toEqual({ ok: false, error: 'Method not found' })
})

test('get_node with an unknown id says so', async () => {
  const { deps } = makeDeps()
  const result = await getNode(deps, { node_id: 'not-a-node' })
  expect(result.ok).toBe(false)
  expect(result.ok ? '' : result.error).toBe(
    'No node with id not-a-node in the method on screen. Call get_graph for the current ids.',
  )
})

test('get_node previews with `to_text` and explains an error', async () => {
  const { deps, db, registry, evaluate } = makeDeps()
  const a = nodeNamed(db, 'a')
  const b = nodeNamed(db, 'b')
  setPayload(registry, a, { type: 'Value' })
  setPayload(registry, b, { type: 'DataflowError', trace: [] })
  evaluate.mockImplementation(async (_scope, expression) =>
    expression === 'a.to_text' ? Ok('y'.repeat(25_000))
    : expression === 'b.catch_primitive (e -> e.to_display_text)' ? Ok('Division by zero')
    : Err('unexpected'),
  )
  const nodeA = parseValue(await getNode(deps, { node_id: a }))
  expect(evaluate).toHaveBeenCalledWith(
    db.nodeIdToNode.get(a)!.outerAst.externalId,
    'a.to_text',
    10_000,
  )
  expect(nodeA.preview).toBe('y'.repeat(NODE_PREVIEW_CHARS) + '…')
  const nodeB = parseValue(await getNode(deps, { node_id: b }))
  expect(nodeB).toMatchObject({ state: 'error', error: 'Division by zero' })
})
