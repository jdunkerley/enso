import { GraphDb, type NodeId } from '$/providers/openedProjects/graph/graphDatabase'
import { DEFAULT_ICON, displayedIconOf, iconOfNode } from '@/util/getIconName'
import { ProjectPath } from '@/util/projectPath'
import type { QualifiedName } from '@/util/qualifiedName'
import { expect, test } from 'vitest'

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
