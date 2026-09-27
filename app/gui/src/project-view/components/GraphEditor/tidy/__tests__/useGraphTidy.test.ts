import type { GraphStore } from '$/providers/openedProjects/graph'
import { parseWithSpans } from '$/providers/openedProjects/graph/__tests__/parseWithSpans'
import {
  GraphDb,
  nodeIdFromOuterAst,
  type NodeId,
} from '$/providers/openedProjects/graph/graphDatabase'
import type { ModuleStore } from '$/providers/openedProjects/module/module'
import { assert, assertDefined } from '@/util/assert'
import { Ast } from '@/util/ast'
import { Vec2 } from '@/util/data/vec2'
import * as iter from 'enso-common/src/utilities/data/iter'
import { expect, test, vi } from 'vitest'
import { ref, watchEffect } from 'vue'
import { buildForest } from '../streamLayout'
import { buildTidyModel, useGraphTidy } from '../useGraphTidy'

const CODE = `main =
    data = Data.read
    other = Data.read
    filtered = data.filter
    joined = filtered.join other
    lonely = 42
`

/** Give every node a distinct, finite position, since freshly-created nodes default to `Infinity`. */
function assignPositions(db: GraphDb) {
  let i = 0
  for (const id of db.nodeIdToNode.keys())
    db.nodeIdToNode.get(id)!.position = new Vec2(i++ * 200, 0)
}

/**
 * A `pickInCodeOrder` matching the real one exposed by the graph store (`graph.ts`), but reading
 * the body straight from `func` instead of `getExecutedMethodAst()` — no execution context is
 * needed to test that `buildTidyModel` orders by this rather than by `db.nodeIdToNode`'s
 * insertion order.
 */
function pickInCodeOrder(func: Ast.FunctionDef) {
  return (ids: Set<NodeId>): NodeId[] => {
    const result: NodeId[] = []
    for (const expr of func.bodyExpressions()) {
      const nodeId = nodeIdFromOuterAst(expr)
      if (nodeId && ids.has(nodeId)) result.push(nodeId)
    }
    return result
  }
}

/** A `GraphDb` built from the fixture, following the pattern in `graphDatabase.test.ts`. */
function setUpDb(code: string = CODE) {
  const { ast, getSpan } = parseWithSpans(code, {})
  const db = GraphDb.Mock()
  const func = iter.first(ast.statements())
  assert(func instanceof Ast.FunctionDef)
  db.updateExternalIds(ast)
  db.updateNodes(func, { watchEffect })
  db.updateBindings(func, { text: code, getSpan })
  assignPositions(db)
  const nodeId = (ident: string) => {
    const id = db.getIdentDefiningNode(ident)
    assertDefined(id)
    return id
  }
  return { db, func, nodeId }
}

/** A minimal fake `GraphStore`/`ModuleStore` pair exposing only what `useGraphTidy` uses. */
function setUpStores(db: GraphDb, func: Ast.FunctionDef) {
  const setNodePosition = vi.fn()
  const graphStore = {
    db,
    visibleArea: () => undefined,
    setNodePosition,
    pickInCodeOrder: pickInCodeOrder(func),
  } as unknown as GraphStore
  const batchEdits = vi.fn((f: () => void) => f())
  const module = ref({ batchEdits } as unknown as ModuleStore)
  return { graphStore, module, setNodePosition, batchEdits }
}

test('buildTidyModel: one component per node, in code order', () => {
  const { db, func, nodeId } = setUpDb()
  const model = buildTidyModel(
    db,
    undefined,
    () => new Vec2(100, 32),
    new Vec2(100, 32),
    pickInCodeOrder(func),
  )
  expect(model.map((c) => c.id)).toEqual(
    ['data', 'other', 'filtered', 'joined', 'lonely'].map(nodeId),
  )
  expect(model.map((c) => c.order)).toEqual([0, 1, 2, 3, 4])
})

test('buildTidyModel: code order reflects the real line, not db.nodeIdToNode insertion order', () => {
  const { db, func, nodeId } = setUpDb()
  const otherId = nodeId('other')
  // `other` reaching the db last, as happens when a mid-function node is (re-)discovered after the
  // others: `ReactiveDb.set` always deletes before inserting, so it always ends up last in `Map`
  // iteration order (graphDatabase.ts), regardless of which line it is actually on.
  db.nodeIdToNode.set(otherId, db.nodeIdToNode.get(otherId)!)
  expect([...db.nodeIdToNode.keys()].indexOf(otherId)).toBe(4)

  const model = buildTidyModel(
    db,
    undefined,
    () => new Vec2(100, 32),
    new Vec2(100, 32),
    pickInCodeOrder(func),
  )
  // `other` is still second: its code line, not its (now-last) map position.
  expect(model.map((c) => c.id)).toEqual(
    ['data', 'other', 'filtered', 'joined', 'lonely'].map(nodeId),
  )
  expect(model.map((c) => c.order)).toEqual([0, 1, 2, 3, 4])
})

test('buildTidyModel: model ids are unique', () => {
  const { db, func } = setUpDb()
  const model = buildTidyModel(
    db,
    undefined,
    () => new Vec2(100, 32),
    new Vec2(100, 32),
    pickInCodeOrder(func),
  )
  expect(new Set(model.map((c) => c.id)).size).toBe(model.length)
})

test('buildTidyModel: self source and inputs follow the primary application', () => {
  const { db, func, nodeId } = setUpDb()
  const model = buildTidyModel(
    db,
    undefined,
    () => new Vec2(100, 32),
    new Vec2(100, 32),
    pickInCodeOrder(func),
  )
  const byId = new Map(model.map((c) => [c.id, c]))
  const data = nodeId('data')
  const other = nodeId('other')
  const filtered = nodeId('filtered')
  const joined = nodeId('joined')
  const lonely = nodeId('lonely')

  expect(byId.get(filtered)?.selfSource).toBe(data)
  expect(byId.get(filtered)?.inputs).toEqual([data])

  expect(byId.get(joined)?.selfSource).toBe(filtered)
  expect(byId.get(joined)?.inputs).toEqual([filtered, other])

  expect(byId.get(data)?.inputs).toEqual([])
  expect(byId.get(data)?.selfSource).toBeUndefined()
  expect(byId.get(other)?.inputs).toEqual([])
  expect(byId.get(lonely)?.inputs).toEqual([])
})

test('buildTidyModel: scope excludes out-of-scope inputs and other components', () => {
  const { db, func, nodeId } = setUpDb()
  const filtered = nodeId('filtered')
  const joined = nodeId('joined')
  const scope = new Set<NodeId>([filtered, joined])
  const model = buildTidyModel(
    db,
    scope,
    () => new Vec2(100, 32),
    new Vec2(100, 32),
    pickInCodeOrder(func),
  )
  const byId = new Map(model.map((c) => [c.id, c]))

  expect(new Set(model.map((c) => c.id))).toEqual(scope)
  expect(byId.get(joined)?.inputs).toEqual([filtered])
  expect(byId.get(filtered)?.inputs).toEqual([])
})

test('buildTidyModel: sizeOf returning undefined falls back to defaultSize', () => {
  const { db, func, nodeId } = setUpDb()
  const defaultSize = new Vec2(123, 45)
  const dataId = nodeId('data')
  const model = buildTidyModel(
    db,
    undefined,
    (id) => (id === dataId ? undefined : new Vec2(1, 1)),
    defaultSize,
    pickInCodeOrder(func),
  )
  const dataComponent = model.find((c) => c.id === dataId)
  expect(dataComponent?.size).toEqual(defaultSize)
})

test('buildTidyModel: a function argument becomes a root input component, wired via iterateConnections', () => {
  const code = `main x =
    data = x.parse
    other = data.next
`
  const { db, func, nodeId } = setUpDb(code)
  const inputId = [...db.nodeIdToNode].find(([, node]) => node.type === 'input')?.[0]
  assertDefined(inputId)
  const dataId = nodeId('data')
  const otherId = nodeId('other')

  const model = buildTidyModel(
    db,
    undefined,
    () => new Vec2(100, 32),
    new Vec2(100, 32),
    pickInCodeOrder(func),
  )
  const byId = new Map(model.map((c) => [c.id, c]))

  // The argument has no inputs of its own, so it becomes a root of the stream forest.
  expect(byId.get(inputId)?.inputs).toEqual([])
  expect(byId.get(inputId)?.selfSource).toBeUndefined()
  const forest = buildForest(model)
  expect(forest.initialOrder.roots).toContain(inputId)

  // `data`'s self source is the argument, wired the same way as any other connection.
  expect(byId.get(dataId)?.selfSource).toBe(inputId)
  expect(byId.get(dataId)?.inputs).toEqual([inputId])
  expect(byId.get(otherId)?.selfSource).toBe(dataId)
})

test('useGraphTidy: tidies the whole graph when nothing (or one node) is selected', () => {
  const { db, func, nodeId } = setUpDb()
  const { graphStore, module, setNodePosition, batchEdits } = setUpStores(db, func)

  useGraphTidy(graphStore, module).tidy()
  expect(batchEdits).toHaveBeenCalledTimes(1)
  expect(setNodePosition).toHaveBeenCalledTimes(5)

  setNodePosition.mockClear()
  batchEdits.mockClear()

  // A single selected node is the same as no selection: the whole graph is tidied, not just it.
  useGraphTidy(graphStore, module).tidy([nodeId('data')])
  expect(batchEdits).toHaveBeenCalledTimes(1)
  expect(setNodePosition).toHaveBeenCalledTimes(5)
})

test('useGraphTidy: tidies only the selection when more than one node is selected', () => {
  const { db, func, nodeId } = setUpDb()
  const { graphStore, module, setNodePosition, batchEdits } = setUpStores(db, func)

  useGraphTidy(graphStore, module).tidy([nodeId('filtered'), nodeId('joined')])

  expect(batchEdits).toHaveBeenCalledTimes(1)
  expect(setNodePosition).toHaveBeenCalledTimes(2)
})

test('useGraphTidy: writes real column positions — the child continuing a column shares its parent’s left x and sits below it', () => {
  const { db, func, nodeId } = setUpDb()
  const { graphStore, module, setNodePosition } = setUpStores(db, func)
  // Components are left-aligned in their column, so this holds regardless of size; a fixed size
  // for every component just keeps the fixture simple.
  const size = new Vec2(100, 32)
  vi.spyOn(graphStore, 'visibleArea').mockReturnValue({ size } as any)

  useGraphTidy(graphStore, module).tidy()

  const written = new Map(setNodePosition.mock.calls.map(([id, pos]) => [id, pos as Vec2]))
  const dataPos = written.get(nodeId('data'))
  const filteredPos = written.get(nodeId('filtered'))
  assertDefined(dataPos)
  assertDefined(filteredPos)
  // `filtered`'s self source is `data`, so it continues `data`'s column.
  expect(filteredPos.x).toBe(dataPos.x)
  expect(filteredPos.y).toBeGreaterThan(dataPos.y)
})

test('useGraphTidy: a non-finite position is not written and does not crash the layout', () => {
  const { db, func, nodeId } = setUpDb()
  const { graphStore, module, setNodePosition, batchEdits } = setUpStores(db, func)
  const lonelyId = nodeId('lonely')
  // As a freshly-created, never-placed node would be (see `assignPositions`'s docstring above).
  db.nodeIdToNode.get(lonelyId)!.position = new Vec2(Infinity, Infinity)

  expect(() => useGraphTidy(graphStore, module).tidy()).not.toThrow()

  expect(batchEdits).toHaveBeenCalledTimes(1)
  expect(setNodePosition).toHaveBeenCalledTimes(4)
  expect(setNodePosition.mock.calls.map(([id]) => id)).not.toContain(lonelyId)
})

test('useGraphTidy: does nothing with fewer than two in-scope components', () => {
  const { db, func } = setUpDb(`main =
    lonely = 42
`)
  const { graphStore, module, setNodePosition, batchEdits } = setUpStores(db, func)

  useGraphTidy(graphStore, module).tidy()

  expect(batchEdits).not.toHaveBeenCalled()
  expect(setNodePosition).not.toHaveBeenCalled()
})
