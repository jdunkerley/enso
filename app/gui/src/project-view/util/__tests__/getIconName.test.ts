import { GraphDb, type NodeId } from '$/providers/openedProjects/graph/graphDatabase'
import {
  ComputedValueRegistry,
  TypeInfo,
} from '$/providers/openedProjects/project/computedValueRegistry'
import { SuggestionDb } from '$/providers/openedProjects/suggestionDatabase'
import { DEFAULT_ICON, displayedIconOf, iconOfNode } from '@/util/getIconName'
import { ProjectPath } from '@/util/projectPath'
import type { QualifiedName } from '@/util/qualifiedName'
import { expect, test } from 'vitest'
import { ref } from 'vue'

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

test('until suggestions are loaded, the cached icon beats a known type', () => {
  expect(
    displayedIconOf(undefined, undefined, textType, 'table', { preferFallbackOverType: true }),
  ).toBe('table')
})

test('until suggestions are loaded, without a cached icon the type is used', () => {
  expect(
    displayedIconOf(undefined, undefined, textType, undefined, { preferFallbackOverType: true }),
  ).toBe('text_input')
})

test('once suggestions are loaded, a known type beats the cached icon', () => {
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
