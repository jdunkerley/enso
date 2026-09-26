import { GraphDb, type NodeId } from '$/providers/openedProjects/graph/graphDatabase'
import {
  ComputedValueRegistry,
  TypeInfo,
} from '$/providers/openedProjects/project/computedValueRegistry'
import { SuggestionDb } from '$/providers/openedProjects/suggestionDatabase'
import { entryMethodPointer } from '$/providers/openedProjects/suggestionDatabase/entry'
import { makeMethod } from '$/providers/openedProjects/suggestionDatabase/mockSuggestion'
import { DEFAULT_ICON, displayedIconOf, iconOfNode, selfAccessChainIcon } from '@/util/getIconName'
import { ProjectPath } from '@/util/projectPath'
import type { QualifiedName } from '@/util/qualifiedName'
import { expect, test } from 'vitest'
import { nextTick, ref } from 'vue'

const textType = ProjectPath.create(
  'Standard.Base' as QualifiedName,
  'Data.Text.Text' as QualifiedName,
)

test('with nothing known, the default icon is used', () => {
  expect(displayedIconOf()).toBe(DEFAULT_ICON)
})

test('with nothing known, the cached icon is used', () => {
  expect(displayedIconOf(undefined, undefined, undefined, 'table')).toBe('table')
})

test('a known type beats the cached icon', () => {
  expect(displayedIconOf(undefined, undefined, textType, 'table')).toBe('text_input')
})

test('iconOfNode shows the cached icon, unless asked for the icon from current data alone', () => {
  const id = '3d0e9b96-3ca0-4c35-a820-7d3a1649de55' as NodeId
  const db = GraphDb.Mock()
  db.mockNode('node1', id)
  expect(iconOfNode(id, db)).toBe(DEFAULT_ICON)
  db.nodeIdToNode.get(id)!.cachedAppearance = { icon: 'table' }
  expect(iconOfNode(id, db)).toBe('table')
  expect(iconOfNode(id, db, { useCachedIcon: true })).toBe('table')
  expect(iconOfNode(id, db, { useCachedIcon: false })).toBe(DEFAULT_ICON)
})

test('while the entry may be pending, the cached icon beats a known type', () => {
  expect(
    displayedIconOf(undefined, undefined, textType, 'table', { preferFallbackOverType: true }),
  ).toBe('table')
})

test('while the entry may be pending, without a cached icon the type is used', () => {
  expect(
    displayedIconOf(undefined, undefined, textType, undefined, { preferFallbackOverType: true }),
  ).toBe('text_input')
})

test('otherwise, a known type beats the cached icon', () => {
  expect(
    displayedIconOf(undefined, undefined, textType, 'table', { preferFallbackOverType: false }),
  ).toBe('text_input')
})

test('iconOfNode prefers the cached icon to the type until suggestions are loaded', () => {
  const id = '3d0e9b96-3ca0-4c35-a820-7d3a1649de55' as NodeId
  const registry = ComputedValueRegistry.Mock()
  registry.db.set(id, {
    typeInfo: TypeInfo.fromParsedTypes([textType], [])!,
    methodCall: undefined,
    payload: { type: 'Value' },
    profilingInfo: [],
    evaluationId: 1,
  })
  const suggestionsLoaded = ref(false)
  const db = GraphDb.Mock(registry, new SuggestionDb(), undefined, suggestionsLoaded)
  db.mockNode('node1', id)
  db.nodeIdToNode.get(id)!.cachedAppearance = { icon: 'table' }
  expect(iconOfNode(id, db)).toBe('table')
  // The writer asks for the icon from current data alone, which the flag does not change.
  expect(iconOfNode(id, db, { useCachedIcon: false })).toBe('text_input')
  suggestionsLoaded.value = true
  expect(iconOfNode(id, db)).toBe('text_input')
})

test('iconOfNode prefers the cached icon until the node method call has a suggestion entry', async () => {
  const id = '3d0e9b96-3ca0-4c35-a820-7d3a1649de55' as NodeId
  const method = makeMethod('Standard.Base.Data.Text.Text.to_case', { icon: 'text' })
  const methodPointer = entryMethodPointer(method)!
  const registry = ComputedValueRegistry.Mock()
  const suggestionDb = new SuggestionDb()
  const db = GraphDb.Mock(registry, suggestionDb)
  const node = db.mockNode('node1', id)
  db.updateExternalIds(node.outerAst)
  const info = {
    typeInfo: TypeInfo.fromParsedTypes([textType], [])!,
    methodCall: { methodPointer, notAppliedArguments: [] },
    payload: { type: 'Value' } as const,
    profilingInfo: [],
    evaluationId: 1,
  }
  // The node's own id and its inner expression's are the same expression in a real graph.
  registry.db.set(id, info)
  registry.db.set(node.innerExpr.externalId, info)
  db.nodeIdToNode.get(id)!.cachedAppearance = { icon: 'table' }
  expect(iconOfNode(id, db)).toBe('table')
  suggestionDb.set(1, method)
  // The suggestion database indexes a new entry on the next tick.
  await nextTick()
  expect(iconOfNode(id, db)).toBe('text')
})

test(
  'selfAccessChainIcon: a node with a pending method call prefers the cached icon to the ' +
    'type, and the entry icon once the entry arrives',
  async () => {
    const id = '3d0e9b96-3ca0-4c35-a820-7d3a1649de55' as NodeId
    const method = makeMethod('Standard.Base.Data.Text.Text.to_case', { icon: 'text' })
    const methodPointer = entryMethodPointer(method)!
    const registry = ComputedValueRegistry.Mock()
    const suggestionDb = new SuggestionDb()
    const db = GraphDb.Mock(registry, suggestionDb)
    const node = db.mockNode('node1', id)
    db.updateExternalIds(node.outerAst)
    const info = {
      typeInfo: TypeInfo.fromParsedTypes([textType], [])!,
      methodCall: { methodPointer, notAppliedArguments: [] },
      payload: { type: 'Value' } as const,
      profilingInfo: [],
      evaluationId: 1,
    }
    // The node's own id and its inner expression's are the same expression in a real graph.
    registry.db.set(id, info)
    registry.db.set(node.innerExpr.externalId, info)
    db.nodeIdToNode.get(id)!.cachedAppearance = { icon: 'table' }

    // The suggestion database does not have the entry yet: `WidgetFunction`'s
    // `getMethodCallInfoRecursively` would find nothing, so the widget's `callInfo` is undefined,
    // just like `db.getMethodCallInfo` here.
    expect(db.getMethodCallInfo(node.innerExpr.id)).toBeUndefined()
    expect(db.isNodeSuggestionPending(id)).toBe(true)
    expect(selfAccessChainIcon(db, id, undefined, textType)).toBe('table')

    suggestionDb.set(1, method)
    // The suggestion database indexes a new entry on the next tick.
    await nextTick()
    expect(db.isNodeSuggestionPending(id)).toBe(false)
    const callInfo = db.getMethodCallInfo(node.innerExpr.id)
    expect(callInfo).toBeDefined()
    expect(selfAccessChainIcon(db, id, callInfo, textType)).toBe('text')
  },
)

test('selfAccessChainIcon: loaded, with no pending entry and no cache, uses the type-derived icon (unchanged behaviour)', () => {
  const id = '3d0e9b96-3ca0-4c35-a820-7d3a1649de55' as NodeId
  const db = GraphDb.Mock()
  db.mockNode('node1', id)
  expect(db.isNodeSuggestionPending(id)).toBe(false)
  expect(selfAccessChainIcon(db, id, undefined, textType)).toBe('text_input')
})

test('iconOfNode: a pending node with a cached colour but no cached icon falls back to the default icon, not the type icon', () => {
  const id = '3d0e9b96-3ca0-4c35-a820-7d3a1649de55' as NodeId
  const registry = ComputedValueRegistry.Mock()
  registry.db.set(id, {
    typeInfo: TypeInfo.fromParsedTypes([textType], [])!,
    methodCall: undefined,
    payload: { type: 'Value' },
    profilingInfo: [],
    evaluationId: 1,
  })
  const db = GraphDb.Mock(registry, new SuggestionDb(), undefined, ref(false))
  db.mockNode('node1', id)
  db.nodeIdToNode.get(id)!.cachedAppearance = { color: '#4a7fb0' }
  expect(db.isNodeSuggestionPending(id)).toBe(true)
  // Without the fix, an icon-less `cachedAppearance` gave no fallback here, so the type icon
  // ('text_input') would show, then flip to the logo once the entry confirmed it has none.
  expect(iconOfNode(id, db)).toBe(DEFAULT_ICON)
})

test('selfAccessChainIcon: a pending node with a cached colour but no cached icon falls back to the default icon', () => {
  const id = '3d0e9b96-3ca0-4c35-a820-7d3a1649de55' as NodeId
  const db = GraphDb.Mock(ComputedValueRegistry.Mock(), new SuggestionDb(), undefined, ref(false))
  db.mockNode('node1', id)
  db.nodeIdToNode.get(id)!.cachedAppearance = { color: '#4a7fb0' }
  expect(db.isNodeSuggestionPending(id)).toBe(true)
  expect(selfAccessChainIcon(db, id, undefined, textType)).toBe(DEFAULT_ICON)
})
