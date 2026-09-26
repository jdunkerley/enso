import { asNodeId, GraphDb, type NodeId } from '$/providers/openedProjects/graph/graphDatabase'
import {
  ComputedValueRegistry,
  TypeInfo,
} from '$/providers/openedProjects/project/computedValueRegistry'
import { SuggestionDb } from '$/providers/openedProjects/suggestionDatabase'
import {
  entryMethodPointer,
  type SuggestionEntry,
} from '$/providers/openedProjects/suggestionDatabase/entry'
import { makeMethod } from '$/providers/openedProjects/suggestionDatabase/mockSuggestion'
import { assert, assertDefined } from '@/util/assert'
import { Ast } from '@/util/ast'
import { stdPath } from '@/util/projectPath'
import type { QualifiedName } from '@/util/qualifiedName'
import * as iter from 'enso-common/src/utilities/data/iter'
import { expect, test } from 'vitest'
import { nextTick, ref, watchEffect } from 'vue'
import type { AstId } from 'ydoc-shared/ast'
import { SourceRange } from 'ydoc-shared/util/data/text'
import { IdMap, type ExternalId } from 'ydoc-shared/yjsModel'

/** TODO: Add docs */
export function parseWithSpans<T extends Record<string, SourceRange>>(code: string, spans: T) {
  const nameToEid = new Map<keyof T, ExternalId>()
  const eid = (name: keyof T) => nameToEid.get(name)!

  const idMap = IdMap.Mock()
  let nextIndex = 0
  for (const name in spans) {
    const span = spans[name]!
    assertDefined(span)
    const indexStr = `${nextIndex++}`
    const eid =
      idMap.getIfExist(span) ??
      (('00000000-0000-0000-0000-000000000000'.slice(0, -indexStr.length) + indexStr) as ExternalId)
    nameToEid.set(name, eid)
    idMap.insertKnownId(span, eid)
  }

  const { root: ast, getSpan } = Ast.parseUpdatingIdMap(code, idMap)
  const idFromExternal = new Map<ExternalId, AstId>()
  Ast.visitRecursive(ast, (ast) => {
    idFromExternal.set(ast.externalId, ast.id)
  })
  const id = (name: keyof T) => idFromExternal.get(eid(name))!

  return { ast, id, eid, getSpan }
}

test('Reading graph from definition', () => {
  const code = `function a =
    node1 = a + 4
    node2 = node1 + 4
    node3 = node2 + 1
    node3`
  const spans = {
    functionName: SourceRange.unsafeFromBounds(0, 8),
    parameter: SourceRange.unsafeFromBounds(9, 10),
    node1Id: SourceRange.unsafeFromBounds(17, 22),
    node1Content: SourceRange.unsafeFromBounds(25, 30),
    node1LParam: SourceRange.unsafeFromBounds(25, 26),
    node1RParam: SourceRange.unsafeFromBounds(29, 30),
    node2Id: SourceRange.unsafeFromBounds(35, 40),
    node2Content: SourceRange.unsafeFromBounds(43, 52),
    node2LParam: SourceRange.unsafeFromBounds(43, 48),
    node2RParam: SourceRange.unsafeFromBounds(51, 52),
    node3Id: SourceRange.unsafeFromBounds(57, 62),
    node3Content: SourceRange.unsafeFromBounds(65, 74),
    output: SourceRange.unsafeFromBounds(79, 84),
  } satisfies Record<string, SourceRange>

  const { ast, id, eid, getSpan } = parseWithSpans(code, spans)

  const db = GraphDb.Mock()
  const func = iter.first(ast.statements())
  assert(func instanceof Ast.FunctionDef)
  db.updateExternalIds(ast)
  db.updateNodes(func, { watchEffect })
  db.updateBindings(func, { text: code, getSpan })

  expect(Array.from(db.nodeIdToNode.keys())).toEqual([
    eid('parameter'),
    eid('node1Content'),
    eid('node2Content'),
    eid('node3Content'),
    eid('output'),
  ])
  expect(db.getExpressionNodeId(id('node1Content'))).toBe(eid('node1Content'))
  expect(db.getExpressionNodeId(id('node1LParam'))).toBe(eid('node1Content'))
  expect(db.getExpressionNodeId(id('node1RParam'))).toBe(eid('node1Content'))
  expect(db.getExpressionNodeId(id('node2Id'))).toBeUndefined()
  expect(db.getExpressionNodeId(id('node2LParam'))).toBe(eid('node2Content'))
  expect(db.getExpressionNodeId(id('node2RParam'))).toBe(eid('node2Content'))
  expect(db.getPatternExpressionNodeId(id('node1Id'))).toBe(eid('node1Content'))
  expect(db.getPatternExpressionNodeId(id('node1Content'))).toBeUndefined()
  expect(db.getPatternExpressionNodeId(id('node2Id'))).toBe(eid('node2Content'))
  expect(db.getPatternExpressionNodeId(id('node2RParam'))).toBeUndefined()
  expect(db.getIdentDefiningNode('node1')).toBe(eid('node1Content'))
  expect(db.getIdentDefiningNode('node2')).toBe(eid('node2Content'))
  expect(db.getIdentDefiningNode('function')).toBeUndefined()
  expect(db.getOutputPortIdentifier(db.getNodeFirstOutputPort(asNodeId(eid('node1Content'))))).toBe(
    'node1',
  )
  expect(db.getOutputPortIdentifier(db.getNodeFirstOutputPort(asNodeId(eid('node2Content'))))).toBe(
    'node2',
  )
  expect(db.getOutputPortIdentifier(db.getNodeFirstOutputPort(asNodeId(eid('node1Id'))))).toBe(
    'node1',
  )

  expect(Array.from(db.connections.allForward(), ([key]) => key)).toEqual([
    id('parameter'),
    id('node1Id'),
    id('node2Id'),
    id('node3Id'),
  ])
  expect(Array.from(db.connections.lookup(id('parameter')))).toEqual([id('node1LParam')])
  expect(Array.from(db.connections.lookup(id('node1Id')))).toEqual([id('node2LParam')])
  expect(Array.from(db.connections.lookup(id('node3Id')))).toEqual([id('output')])
  expect(db.getOutputPortIdentifier(id('parameter'))).toBe('a')
  expect(db.getOutputPortIdentifier(id('node1Id'))).toBe('node1')
  expect(Array.from(db.nodeDependents.lookup(asNodeId(eid('node1Content'))))).toEqual([
    eid('node2Content'),
  ])
  expect(Array.from(db.nodeDependents.lookup(asNodeId(eid('node2Content'))))).toEqual([
    eid('node3Content'),
  ])
  expect(Array.from(db.nodeDependents.lookup(asNodeId(eid('node3Content'))))).toEqual([
    eid('output'),
  ])
})

const CACHED_COLOR = '#4a7fb0'

/**
 * A computed node of type `Integer` with a cached colour, in a {@link GraphDb} whose suggestion
 * database has the mock groups. With `method`, the node's value is a call of that method, which
 * the suggestion database does not know yet.
 */
function setUpTypedNode({
  suggestionsLoaded,
  method,
}: {
  suggestionsLoaded: boolean
  method?: SuggestionEntry
}) {
  const id = '3d0e9b96-3ca0-4c35-a820-7d3a1649de55' as NodeId
  const registry = ComputedValueRegistry.Mock()
  const suggestionDb = new SuggestionDb()
  const loaded = ref(suggestionsLoaded)
  const groups = [
    { name: 'MockGroup1', project: 'Standard.Base' as QualifiedName, color: '#ff0000' },
  ]
  const db = GraphDb.Mock(registry, suggestionDb, undefined, loaded, groups)
  const node = db.mockNode('node1', id)
  db.updateExternalIds(node.outerAst)
  const methodPointer = entryMethodPointer(method)
  const info = {
    typeInfo: TypeInfo.fromParsedTypes([stdPath('Standard.Base.Data.Numbers.Integer')], [])!,
    methodCall: methodPointer && { methodPointer, notAppliedArguments: [] },
    payload: { type: 'Value' } as const,
    profilingInfo: [],
    evaluationId: 1,
  }
  // The node's own id and its inner expression's are the same expression in a real graph.
  registry.db.set(id, info)
  registry.db.set(node.innerExpr.externalId, info)
  db.nodeIdToNode.get(id)!.cachedAppearance = { color: CACHED_COLOR }
  return { id, db, suggestionDb, loaded }
}

test('A typed node shows its cached colour until suggestions are loaded', () => {
  const { id, db, loaded } = setUpTypedNode({ suggestionsLoaded: false })
  expect(db.getNodeColorSource(id)).toBe('cached')
  expect(db.getNodeColorStyle(id)).toBe(CACHED_COLOR)
  expect(db.isNodeSuggestionPending(id)).toBe(true)
  loaded.value = true
  expect(db.getNodeColorSource(id)).toBe('type')
  expect(db.isNodeSuggestionPending(id)).toBe(false)
})

test('A method call node shows its cached colour until its suggestion entry arrives', async () => {
  const method = makeMethod('Standard.Base.Data.Numbers.Integer.abs', {
    group: 'Standard.Base.MockGroup1',
  })
  const { id, db, suggestionDb } = setUpTypedNode({ suggestionsLoaded: true, method })
  expect(db.getNodeColorSource(id)).toBe('cached')
  expect(db.getNodeColorStyle(id)).toBe(CACHED_COLOR)
  expect(db.isNodeSuggestionPending(id)).toBe(true)
  suggestionDb.set(1, method)
  // The suggestion database indexes a new entry on the next tick.
  await nextTick()
  expect(db.getNodeColorSource(id)).toBe('group')
  expect(db.isNodeSuggestionPending(id)).toBe(false)
})

test('A method call node without a group gets its type colour once its entry arrives', async () => {
  const method = makeMethod('Standard.Base.Data.Numbers.Integer.abs')
  const { id, db, suggestionDb } = setUpTypedNode({ suggestionsLoaded: true, method })
  expect(db.getNodeColorSource(id)).toBe('cached')
  suggestionDb.set(1, method)
  // The suggestion database indexes a new entry on the next tick.
  await nextTick()
  expect(db.getNodeColorSource(id)).toBe('type')
})

test('A method call node whose entry is known is not pending', async () => {
  const method = makeMethod('Standard.Base.Data.Numbers.Integer.abs', {
    group: 'Standard.Base.MockGroup1',
  })
  const { id, db, suggestionDb } = setUpTypedNode({ suggestionsLoaded: true, method })
  suggestionDb.set(1, method)
  // The suggestion database indexes a new entry on the next tick.
  await nextTick()
  expect(db.getNodeColorSource(id)).toBe('group')
  expect(db.isNodeSuggestionPending(id)).toBe(false)
})

test('Once suggestions are loaded, the type of a node without a method call beats the cache', () => {
  const { id, db } = setUpTypedNode({ suggestionsLoaded: true })
  expect(db.getNodeColorSource(id)).toBe('type')
  expect(db.isNodeSuggestionPending(id)).toBe(false)
})
