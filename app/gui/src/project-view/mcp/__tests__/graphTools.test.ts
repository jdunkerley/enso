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
import { Err, Ok, type Result } from 'enso-common/src/utilities/data/result'
import { expect, test, vi } from 'vitest'
import { watchEffect } from 'vue'
import type { ExpressionUpdatePayload } from 'ydoc-shared/languageServerTypes'
import {
  GRAPH_NODE_TEXT_CHARS,
  GRAPH_PREVIEW_CHARS,
  GRAPH_PREVIEW_CONCURRENCY,
  GRAPH_PREVIEW_DEADLINE_MS,
  GRAPH_PREVIEW_TOTAL_CHARS,
  GRAPH_SOURCE_CHARS,
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

function makeDeps(overrides: Partial<GraphToolDeps> = {}, code = CODE) {
  const registry = ComputedValueRegistry.Mock()
  const projectNames = mockProjectNameStore()
  const db = GraphDb.Mock(registry, undefined, projectNames)
  const { root, getSpan } = Ast.parseUpdatingIdMap(code)
  const func = [...root.statements()].find((s) => s instanceof Ast.FunctionDef)
  assert(func instanceof Ast.MutableFunctionDef)
  db.updateExternalIds(root)
  db.updateNodes(func, { watchEffect })
  db.updateBindings(func, { text: code, getSpan })
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

test("get_node cuts a long error's text to the preview limit", async () => {
  const { deps, db, registry, evaluate } = makeDeps()
  const b = nodeNamed(db, 'b')
  setPayload(registry, b, { type: 'DataflowError', trace: [] })
  evaluate.mockResolvedValue(Ok('e'.repeat(30_000)))
  const node = parseValue(await getNode(deps, { node_id: b }))
  expect(node.error).toBe('e'.repeat(NODE_PREVIEW_CHARS) + '…')
})

const MANY_NODES = 20

/** A graph of `MANY_NODES` value nodes, whose previews the test resolves one by one. */
function manyValueNodes() {
  const lines = Array.from({ length: MANY_NODES }, (_, i) => `    n${i} = ${i}`)
  let clock = 0
  const fixture = makeDeps({ now: () => clock }, `main =\n${lines.join('\n')}`)
  for (let i = 0; i < MANY_NODES; i++) {
    setPayload(fixture.registry, nodeNamed(fixture.db, `n${i}`), { type: 'Value' })
  }
  const pending: ((result: Result<string>) => void)[] = []
  let inFlight = 0
  let maxInFlight = 0
  fixture.evaluate.mockImplementation(
    () =>
      new Promise((resolve) => {
        inFlight += 1
        maxInFlight = Math.max(maxInFlight, inFlight)
        pending.push((result) => {
          inFlight -= 1
          resolve(result)
        })
      }),
  )
  return {
    ...fixture,
    pending,
    maxInFlight: () => maxInFlight,
    setClock: (ms: number) => (clock = ms),
  }
}

/** Lets the tool's promise chains run until they wait on the next evaluation. */
async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

test('get_graph runs at most a fixed number of previews at once', async () => {
  const { deps, evaluate, pending, maxInFlight } = manyValueNodes()
  const graphPromise = getGraph(deps, {})
  await settle()
  while (pending.length > 0) {
    pending.shift()!(Ok('v'))
    await settle()
  }
  const graph = parseValue(await graphPromise)
  expect(evaluate).toHaveBeenCalledTimes(MANY_NODES)
  expect(maxInFlight()).toBe(GRAPH_PREVIEW_CONCURRENCY)
  expect(graph.nodes.filter((n: { preview?: string }) => n.preview === 'v')).toHaveLength(
    MANY_NODES,
  )
  expect(graph).not.toHaveProperty('previews_skipped')
})

test('get_graph starts no more previews once its deadline has passed', async () => {
  const { deps, evaluate, pending, setClock } = manyValueNodes()
  const graphPromise = getGraph(deps, {})
  await settle()
  expect(pending).toHaveLength(GRAPH_PREVIEW_CONCURRENCY)
  setClock(GRAPH_PREVIEW_DEADLINE_MS)
  for (const resolve of pending.splice(0)) resolve(Ok('v'))
  await settle()
  const graph = parseValue(await graphPromise)
  expect(evaluate).toHaveBeenCalledTimes(GRAPH_PREVIEW_CONCURRENCY)
  expect(graph.previews_skipped).toBe(MANY_NODES - GRAPH_PREVIEW_CONCURRENCY)
  expect(graph.nodes.filter((n: { preview?: string }) => n.preview != null)).toHaveLength(
    GRAPH_PREVIEW_CONCURRENCY,
  )
})

test('get_graph starts no more previews once the collected previews reach the total budget', async () => {
  const count = 30
  const lines = Array.from({ length: count }, (_, i) => `    n${i} = ${i}`)
  const { deps, db, registry, evaluate } = makeDeps({}, `main =\n${lines.join('\n')}`)
  for (let i = 0; i < count; i++) setPayload(registry, nodeNamed(db, `n${i}`), { type: 'Value' })
  evaluate.mockResolvedValue(Ok('p'.repeat(GRAPH_PREVIEW_CHARS)))
  const graph = parseValue(await getGraph(deps, {}))
  const started = evaluate.mock.calls.length
  const fullBudget = GRAPH_PREVIEW_TOTAL_CHARS / GRAPH_PREVIEW_CHARS
  expect(started).toBeGreaterThanOrEqual(fullBudget)
  // Only the previews already in flight when the budget filled may finish after it.
  expect(started).toBeLessThanOrEqual(fullBudget + GRAPH_PREVIEW_CONCURRENCY - 1)
  expect(started).toBeLessThan(count)
  expect(graph.previews_skipped).toBe(count - started)
  expect(graph.nodes.filter((n: { preview?: string }) => n.preview != null)).toHaveLength(started)
})

test('get_graph caps each comment, panic message and expression, and the source', async () => {
  const long = 'q'.repeat(60_000)
  const code = `main =
    ## ${'c'.repeat(3_000)}
    a = "${long}"
    b = a`
  const { deps, db, registry } = makeDeps({}, code)
  setPayload(registry, nodeNamed(db, 'b'), { type: 'Panic', message: 'm'.repeat(3_000), trace: [] })
  const graph = parseValue(await getGraph(deps, { previews: false }))
  expect(graph.source).toBe(code.slice(code.indexOf('main')).slice(0, GRAPH_SOURCE_CHARS) + '…')
  const [a, b] = graph.nodes
  expect(a.comment).toBe('c'.repeat(GRAPH_NODE_TEXT_CHARS) + '…')
  expect(a.code).toBe(`"${long}"`.slice(0, GRAPH_NODE_TEXT_CHARS) + '…')
  expect(b.message).toBe('m'.repeat(GRAPH_NODE_TEXT_CHARS) + '…')
  expect([GRAPH_SOURCE_CHARS, GRAPH_NODE_TEXT_CHARS]).toEqual([50_000, 2_000])
})

test('get_graph leaves a node whose preview rejects without one, and still answers', async () => {
  const { deps, db, registry, evaluate } = makeDeps()
  setPayload(registry, nodeNamed(db, 'a'), { type: 'Value' })
  setPayload(registry, nodeNamed(db, 'b'), { type: 'Value' })
  evaluate.mockImplementation(async (_scope, expression) => {
    if (expression.startsWith('a.')) throw new Error('connection lost')
    return Ok('fine')
  })
  const graph = parseValue(await getGraph(deps, {}))
  expect(graph.nodes[0]).not.toHaveProperty('preview')
  expect(graph.nodes[1].preview).toBe('fine')
})

test('get_node leaves a node whose preview rejects without one, and still answers', async () => {
  const { deps, db, registry, evaluate } = makeDeps()
  const a = nodeNamed(db, 'a')
  setPayload(registry, a, { type: 'Value' })
  evaluate.mockRejectedValue(new Error('connection lost'))
  const node = parseValue(await getNode(deps, { node_id: a }))
  expect(node).toMatchObject({ name: 'a', state: 'value' })
  expect(node).not.toHaveProperty('preview')
})
