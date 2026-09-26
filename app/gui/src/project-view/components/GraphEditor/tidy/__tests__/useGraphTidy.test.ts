import type { GraphStore } from '$/providers/openedProjects/graph'
import { parseWithSpans } from '$/providers/openedProjects/graph/__tests__/graphDatabase.test'
import { GraphDb, type NodeId } from '$/providers/openedProjects/graph/graphDatabase'
import type { ModuleStore } from '$/providers/openedProjects/module/module'
import { assert, assertDefined } from '@/util/assert'
import { Ast } from '@/util/ast'
import { Vec2 } from '@/util/data/vec2'
import * as iter from 'enso-common/src/utilities/data/iter'
import { expect, test, vi } from 'vitest'
import { ref, watchEffect } from 'vue'
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

/** A `GraphDb` built from the fixture, following the pattern in `graphDatabase.test.ts`. */
function setUpDb() {
  const { ast, getSpan } = parseWithSpans(CODE, {})
  const db = GraphDb.Mock()
  const func = iter.first(ast.statements())
  assert(func instanceof Ast.FunctionDef)
  db.updateExternalIds(ast)
  db.updateNodes(func, { watchEffect })
  db.updateBindings(func, { text: CODE, getSpan })
  assignPositions(db)
  const nodeId = (ident: string) => {
    const id = db.getIdentDefiningNode(ident)
    assertDefined(id)
    return id
  }
  return { db, nodeId }
}

/** A minimal fake `GraphStore`/`ModuleStore` pair exposing only what `useGraphTidy` uses. */
function setUpStores(db: GraphDb) {
  const setNodePosition = vi.fn()
  const graphStore = {
    db,
    visibleArea: () => undefined,
    setNodePosition,
  } as unknown as GraphStore
  const batchEdits = vi.fn((f: () => void) => f())
  const module = ref({ batchEdits } as unknown as ModuleStore)
  return { graphStore, module, setNodePosition, batchEdits }
}

test('buildTidyModel: one component per node, in code order', () => {
  const { db, nodeId } = setUpDb()
  const model = buildTidyModel(db, undefined, () => new Vec2(100, 32), new Vec2(100, 32))
  expect(model.map((c) => c.id)).toEqual(
    ['data', 'other', 'filtered', 'joined', 'lonely'].map(nodeId),
  )
  expect(model.map((c) => c.order)).toEqual([0, 1, 2, 3, 4])
})

test('buildTidyModel: model ids are unique', () => {
  const { db } = setUpDb()
  const model = buildTidyModel(db, undefined, () => new Vec2(100, 32), new Vec2(100, 32))
  expect(new Set(model.map((c) => c.id)).size).toBe(model.length)
})

test('buildTidyModel: self source and inputs follow the primary application', () => {
  const { db, nodeId } = setUpDb()
  const model = buildTidyModel(db, undefined, () => new Vec2(100, 32), new Vec2(100, 32))
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
  const { db, nodeId } = setUpDb()
  const filtered = nodeId('filtered')
  const joined = nodeId('joined')
  const scope = new Set<NodeId>([filtered, joined])
  const model = buildTidyModel(db, scope, () => new Vec2(100, 32), new Vec2(100, 32))
  const byId = new Map(model.map((c) => [c.id, c]))

  expect(new Set(model.map((c) => c.id))).toEqual(scope)
  expect(byId.get(joined)?.inputs).toEqual([filtered])
  expect(byId.get(filtered)?.inputs).toEqual([])
})

test('buildTidyModel: sizeOf returning undefined falls back to defaultSize', () => {
  const { db, nodeId } = setUpDb()
  const defaultSize = new Vec2(123, 45)
  const dataId = nodeId('data')
  const model = buildTidyModel(
    db,
    undefined,
    (id) => (id === dataId ? undefined : new Vec2(1, 1)),
    defaultSize,
  )
  const dataComponent = model.find((c) => c.id === dataId)
  expect(dataComponent?.size).toEqual(defaultSize)
})

test('useGraphTidy: tidies the whole graph when nothing (or one node) is selected', () => {
  const { db } = setUpDb()
  const { graphStore, module, setNodePosition, batchEdits } = setUpStores(db)

  useGraphTidy(graphStore, module).tidy()

  expect(batchEdits).toHaveBeenCalledTimes(1)
  expect(setNodePosition).toHaveBeenCalledTimes(5)
})

test('useGraphTidy: tidies only the selection when more than one node is selected', () => {
  const { db, nodeId } = setUpDb()
  const { graphStore, module, setNodePosition, batchEdits } = setUpStores(db)

  useGraphTidy(graphStore, module).tidy([nodeId('filtered'), nodeId('joined')])

  expect(batchEdits).toHaveBeenCalledTimes(1)
  expect(setNodePosition).toHaveBeenCalledTimes(2)
})

test('useGraphTidy: does nothing with fewer than two in-scope components', () => {
  const code = `main =
    lonely = 42
`
  const { ast, getSpan } = parseWithSpans(code, {})
  const db = GraphDb.Mock()
  const func = iter.first(ast.statements())
  assert(func instanceof Ast.FunctionDef)
  db.updateExternalIds(ast)
  db.updateNodes(func, { watchEffect })
  db.updateBindings(func, { text: code, getSpan })
  assignPositions(db)

  const { graphStore, module, setNodePosition, batchEdits } = setUpStores(db)

  useGraphTidy(graphStore, module).tidy()

  expect(batchEdits).not.toHaveBeenCalled()
  expect(setNodePosition).not.toHaveBeenCalled()
})
